/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Note: this file is included in aboutDialog.xhtml and preferences/advanced.xhtml
// if MOZ_UPDATER is defined.

var { XPCOMUtils } = ChromeUtils.import(
  "resource://gre/modules/XPCOMUtils.jsm"
);
var { DownloadUtils } = ChromeUtils.import(
  "resource://gre/modules/DownloadUtils.jsm"
);

ChromeUtils.defineESModuleGetters(this, {
  UpdateUtils: "resource://gre/modules/UpdateUtils.sys.mjs",
});

const PREF_APP_UPDATE_CANCELATIONS_OSX = "app.update.cancelations.osx";
const PREF_APP_UPDATE_ELEVATE_NEVER = "app.update.elevate.never";

var gAppUpdater;

function onUnload(aEvent) {
  if (gAppUpdater) {
    if (gAppUpdater.isChecking) {
      gAppUpdater.checker.stopCurrentCheck();
    }
    // Safe to call even when there isn't a download in progress.
    gAppUpdater.removeDownloadListener();
    gAppUpdater = null;
  }
}

function appUpdater(options = {}) {
  XPCOMUtils.defineLazyServiceGetter(
    this,
    "aus",
    "@mozilla.org/updates/update-service;1",
    "nsIApplicationUpdateService"
  );
  XPCOMUtils.defineLazyServiceGetter(
    this,
    "checker",
    "@mozilla.org/updates/update-checker;1",
    "nsIUpdateChecker"
  );
  XPCOMUtils.defineLazyServiceGetter(
    this,
    "um",
    "@mozilla.org/updates/update-manager;1",
    "nsIUpdateManager"
  );

  this.options = options;
  this.updateDeck = document.getElementById("updateDeck");
  this.promiseAutoUpdateSetting = null;

  this.bundle = Services.strings.createBundle(
    "chrome://messenger/locale/messenger.properties"
  );

  let manualURL = Services.urlFormatter.formatURLPref("app.update.url.manual");
  document.getElementById("manualLink").href = manualURL;
  document.getElementById("failedLink").href = manualURL;

  if (this.updateDisabledByPackage) {
    return;
  }

  if (this.updateDisabledByPolicy) {
    this.selectPanel("policyDisabled");
    return;
  }

  if (this.isReadyForRestart) {
    this.selectPanel("apply");
    return;
  }

  if (this.aus.isOtherInstanceHandlingUpdates) {
    this.selectPanel("otherInstanceHandlingUpdates");
    return;
  }

  if (this.isDownloading) {
    this.startDownload();
    // selectPanel("downloading") is called from setupDownloadingUI().
    return;
  }

  if (this.isStaging) {
    this.waitForUpdateToStage();
    // selectPanel("applying"); is called from waitForUpdateToStage().
    return;
  }

  // We might need this value later, so start loading it from the disk now.
  this.promiseAutoUpdateSetting = UpdateUtils.getAppUpdateAutoEnabled();

  // That leaves the options
  // "Check for updates, but let me choose whether to install them", and
  // "Automatically install updates".
  // In both cases, we check for updates without asking.
  // In the "let me choose" case, we ask before downloading though, in onCheckComplete.
  this.checkForUpdates();
}

appUpdater.prototype = {
  // true when there is an update check in progress.
  isChecking: false,

  get selectedPanel() {
    return this.updateDeck.querySelector(".selected");
  },

  // true when there is an update ready to be applied on restart or staged.
  get isPending() {
    if (this.update) {
      return (
        this.update.state == "pending" ||
        this.update.state == "pending-service" ||
        this.update.state == "pending-elevate"
      );
    }
    return (
      this.um.readyUpdate &&
      (this.um.readyUpdate.state == "pending" ||
        this.um.readyUpdate.state == "pending-service" ||
        this.um.readyUpdate.state == "pending-elevate")
    );
  },

  // true when there is an update already staged.
  get isApplied() {
    if (this.update) {
      return (
        this.update.state == "applied" || this.update.state == "applied-service"
      );
    }
    return (
      this.um.readyUpdate &&
      (this.um.readyUpdate.state == "applied" ||
        this.um.readyUpdate.state == "applied-service")
    );
  },

  get isStaging() {
    if (!this.updateStagingEnabled) {
      return false;
    }
    let errorCode;
    if (this.update) {
      errorCode = this.update.errorCode;
    } else if (this.um.readyUpdate) {
      errorCode = this.um.readyUpdate.errorCode;
    }
    // If the state is pending and the error code is not 0, staging must have
    // failed.
    return this.isPending && errorCode == 0;
  },

  // true when an update ready to restart to finish the update process.
  get isReadyForRestart() {
    if (this.updateStagingEnabled) {
      let errorCode;
      if (this.update) {
        errorCode = this.update.errorCode;
      } else if (this.um.readyUpdate) {
        errorCode = this.um.readyUpdate.errorCode;
      }
      // If the state is pending and the error code is not 0, staging must have
      // failed and Firefox should be restarted to try to apply the update
      // without staging.
      return this.isApplied || (this.isPending && errorCode != 0);
    }
    return this.isPending;
  },

  // true when there is an update download in progress.
  get isDownloading() {
    if (this.update) {
      return this.update.state == "downloading";
    }
    return (
      this.um.downloadingUpdate &&
      this.um.downloadingUpdate.state == "downloading"
    );
  },

  // true when updating has been disabled by enterprise policy
  get updateDisabledByPolicy() {
    return Services.policies && !Services.policies.isAllowed("appUpdate");
  },

  // true if updating is disabled because we're running in an app package.
  // This is distinct from updateDisabledByPolicy because we need to avoid
  // messages being shown to the user about an "administrator" handling
  // updates; packaged apps may be getting updated by an administrator or they
  // may not be, and we don't have a good way to tell the difference from here,
  // so we err to the side of less confusion for unmanaged users.
  get updateDisabledByPackage() {
    try {
      return Services.sysinfo.getProperty("hasWinPackageId");
    } catch (_ex) {
      // The hasWinPackageId property doesn't exist; assume it would be false.
    }
    // Check for distributor.id and updates disabled via policy
    let defaults = Services.prefs.getDefaultBranch(null);
    let distribId = Boolean(defaults.getCharPref("distribution.id", ""));
    return distribId && this.updateDisabledByPolicy;
  },

  // true when updating in background is enabled.
  get updateStagingEnabled() {
    return (
      !this.updateDisabledByPolicy &&
      !this.updateDisabledByPackage &&
      this.aus.canStageUpdates
    );
  },

  /**
   * Sets the panel of the updateDeck.
   *
   * @param  aChildID
   *         The id of the deck's child to select, e.g. "apply".
   */
  selectPanel(aChildID) {
    let panel = document.getElementById(aChildID);

    let button = panel.querySelector("button");
    if (button) {
      if (aChildID == "downloadAndInstall") {
        let updateVersion = gAppUpdater.update.displayVersion;
        // Include the build ID if this is an "a#" (nightly or aurora) build
        if (/a\d+$/.test(updateVersion)) {
          let buildID = gAppUpdater.update.buildID;
          let year = buildID.slice(0, 4);
          let month = buildID.slice(4, 6);
          let day = buildID.slice(6, 8);
          updateVersion += ` (${year}-${month}-${day})`;
        } else {
          let updateNotesLink = document.getElementById("updateNotes");
          if (updateNotesLink) {
            updateNotesLink.href = gAppUpdater.update.detailsURL;
            updateNotesLink.hidden = false;
          }
        }
        button.textContent = this.bundle.formatStringFromName(
          "update.downloadAndInstallButton.label",
          [updateVersion]
        );
        button.accessKey = this.bundle.GetStringFromName(
          "update.downloadAndInstallButton.accesskey"
        );
      }
      this.selectedPanel?.classList.remove("selected");
      panel.classList.add("selected");
      if (
        this.options.buttonAutoFocus &&
        (!document.commandDispatcher.focusedElement || // don't steal the focus
          document.commandDispatcher.focusedElement.localName == "button")
      ) {
        // except from the other buttons
        button.focus();
      }
    } else {
      this.selectedPanel?.classList.remove("selected");
      panel.classList.add("selected");
    }
  },

  /**
   * Check for updates
   */
  checkForUpdates() {
    // Clear prefs that could prevent a user from discovering available updates.
    if (Services.prefs.prefHasUserValue(PREF_APP_UPDATE_CANCELATIONS_OSX)) {
      Services.prefs.clearUserPref(PREF_APP_UPDATE_CANCELATIONS_OSX);
    }
    if (Services.prefs.prefHasUserValue(PREF_APP_UPDATE_ELEVATE_NEVER)) {
      Services.prefs.clearUserPref(PREF_APP_UPDATE_ELEVATE_NEVER);
    }
    this.selectPanel("checkingForUpdates");
    this.isChecking = true;
    this.checker.checkForUpdates(this.updateCheckListener, true);
    // after checking, onCheckComplete() is called
  },

  /**
   * Handles oncommand for the "Restart to Update" button
   * which is presented after the download has been downloaded.
   */
  buttonRestartAfterDownload() {
    if (!this.isReadyForRestart) {
      return;
    }

    gAppUpdater.selectPanel("restarting");

    // Notify all windows that an application quit has been requested.
    let cancelQuit = Cc["@mozilla.org/supports-PRBool;1"].createInstance(
      Ci.nsISupportsPRBool
    );
    Services.obs.notifyObservers(
      cancelQuit,
      "quit-application-requested",
      "restart"
    );

    // Something aborted the quit process.
    if (cancelQuit.data) {
      gAppUpdater.selectPanel("apply");
      return;
    }

    // If already in safe mode restart in safe mode (bug 327119)
    if (Services.appinfo.inSafeMode) {
      Services.startup.restartInSafeMode(Ci.nsIAppStartup.eAttemptQuit);
      return;
    }

    Services.startup.quit(
      Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart
    );
  },

  /**
   * Implements nsIUpdateCheckListener. The methods implemented by
   * nsIUpdateCheckListener are in a different scope from nsIIncrementalDownload
   * to make it clear which are used by each interface.
   */
  updateCheckListener: {
    /**
     * See nsIUpdateService.idl
     */
    onCheckComplete(aRequest, aUpdates) {
      gAppUpdater.isChecking = false;
      gAppUpdater.update = gAppUpdater.aus.selectUpdate(aUpdates);
      if (!gAppUpdater.update) {
        gAppUpdater.selectPanel("noUpdatesFound");
        return;
      }

      if (gAppUpdater.update.unsupported) {
        let unsupportedLink = document.getElementById("unsupportedLink");
        if (gAppUpdater.update.detailsURL) {
          unsupportedLink.href = gAppUpdater.update.detailsURL;
        } else {
          unsupportedLink.hidden = true;
        }

        gAppUpdater.selectPanel("unsupportedSystem");
        return;
      }

      if (!gAppUpdater.aus.canApplyUpdates) {
        gAppUpdater.selectPanel("manualUpdate");
        return;
      }

      // when called from About dialog or preferences tab always ask!
      gAppUpdater.selectPanel("downloadAndInstall");
    },

    /**
     * See nsIUpdateService.idl
     */
    onError(aRequest, aUpdate) {
      // Errors in the update check are treated as no updates found. If the
      // update check fails repeatedly without a success the user will be
      // notified with the normal app update user interface so this is safe.
      gAppUpdater.isChecking = false;
      gAppUpdater.selectPanel("noUpdatesFound");
    },

    /**
     * See nsISupports.idl
     */
    QueryInterface: ChromeUtils.generateQI(["nsIUpdateCheckListener"]),
  },

  /**
   * Shows the applying UI until the update has finished staging
   */
  waitForUpdateToStage() {
    if (!this.update) {
      this.update = this.um.readyUpdate;
    }
    this.update.QueryInterface(Ci.nsIWritablePropertyBag);
    this.update.setProperty("foregroundDownload", "true");
    this.selectPanel("applying");
    this.updateUIWhenStagingComplete();
  },

  /**
   * Starts the download of an update mar.
   */
  startDownload() {
    if (!this.update) {
      this.update = this.um.downloadingUpdate;
    }
    this.update.QueryInterface(Ci.nsIWritablePropertyBag);
    this.update.setProperty("foregroundDownload", "true");

    let success = this.aus.downloadUpdate(this.update, false);
    if (!success) {
      this.selectPanel("downloadFailed");
      return;
    }

    this.setupDownloadingUI();
  },

  /**
   * Switches to the UI responsible for tracking the download.
   */
  setupDownloadingUI() {
    this.downloadStatus = document.getElementById("downloadStatus");
    this.downloadStatus.textContent = DownloadUtils.getTransferTotal(
      0,
      this.update.selectedPatch.size
    );
    this.selectPanel("downloading");
    this.aus.addDownloadListener(this);
  },

  removeDownloadListener() {
    if (this.aus) {
      this.aus.removeDownloadListener(this);
    }
  },

  /**
   * See nsIRequestObserver.idl
   */
  onStartRequest(aRequest) {},

  /**
   * See nsIRequestObserver.idl
   */
  onStopRequest(aRequest, aStatusCode) {
    switch (aStatusCode) {
      case Cr.NS_ERROR_UNEXPECTED:
        if (
          this.update.selectedPatch.state == "download-failed" &&
          (this.update.isCompleteUpdate || this.update.patchCount != 2)
        ) {
          // Verification error of complete patch, informational text is held in
          // the update object.
          this.removeDownloadListener();
          this.selectPanel("downloadFailed");
          break;
        }
        // Verification failed for a partial patch, complete patch is now
        // downloading so return early and do NOT remove the download listener!
        break;
      case Cr.NS_BINDING_ABORTED:
        // Do not remove UI listener since the user may resume downloading again.
        break;
      case Cr.NS_OK:
        this.removeDownloadListener();
        if (this.updateStagingEnabled) {
          this.selectPanel("applying");
          this.updateUIWhenStagingComplete();
        } else {
          this.selectPanel("apply");
        }
        break;
      default:
        this.removeDownloadListener();
        this.selectPanel("downloadFailed");
        break;
    }
  },

  /**
   * See nsIProgressEventSink.idl
   */
  onStatus(aRequest, aStatus, aStatusArg) {},

  /**
   * See nsIProgressEventSink.idl
   */
  onProgress(aRequest, aProgress, aProgressMax) {
    this.downloadStatus.textContent = DownloadUtils.getTransferTotal(
      aProgress,
      aProgressMax
    );
  },

  /**
   * This function registers an observer that watches for the staging process
   * to complete. Once it does, it updates the UI to either request that the
   * user restarts to install the update on success, request that the user
   * manually download and install the newer version, or automatically download
   * a complete update if applicable.
   */
  updateUIWhenStagingComplete() {
    let observer = (aSubject, aTopic, aData) => {
      // Update the UI when the background updater is finished
      let status = aData;
      if (
        status == "applied" ||
        status == "applied-service" ||
        status == "pending" ||
        status == "pending-service" ||
        status == "pending-elevate"
      ) {
        // If the update is successfully applied, or if the updater has
        // fallen back to non-staged updates, show the "Restart to Update"
        // button.
        this.selectPanel("apply");
      } else if (status == "failed") {
        // Background update has failed, let's show the UI responsible for
        // prompting the user to update manually.
        this.selectPanel("downloadFailed");
      } else if (status == "downloading") {
        // We've fallen back to downloading the complete update because the
        // partial update failed to get staged in the background.
        // Therefore we need to keep our observer.
        this.setupDownloadingUI();
        return;
      }
      Services.obs.removeObserver(observer, "update-staged");
    };
    Services.obs.addObserver(observer, "update-staged");
  },

  /**
   * See nsISupports.idl
   */
  QueryInterface: ChromeUtils.generateQI([
    "nsIProgressEventSink",
    "nsIRequestObserver",
  ]),
};

window.addEventListener("load", () => {
  for (let link of document.querySelectorAll(".download-link")) {
    link.addEventListener("click", event => {
      event.preventDefault();
      let messenger =
        window.messenger ||
        Cc["@mozilla.org/messenger;1"].createInstance(Ci.nsIMessenger);
      messenger.launchExternalURL(event.target.href);
    });
  }
});
