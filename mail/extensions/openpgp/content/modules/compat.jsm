/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use strict";

/**
 *  compatibility Module
 */

var EXPORTED_SYMBOLS = ["EnigmailCompat"];

const XPCOM_APPINFO = "@mozilla.org/xre/app-info;1";

var MailUtils;

MailUtils = ChromeUtils.import("resource:///modules/MailUtils.jsm").MailUtils;

var gCompFields, gPgpMimeObj;

var EnigmailCompat = {
  generateQI: function(aCid) {
    return ChromeUtils.generateQI(aCid);
  },

  getExistingFolder: function(folderUri) {
    return MailUtils.getExistingFolder(folderUri);
  },

  /**
   * Get a mail URL from a uriSpec
   *
   * @param uriSpec: String - URI of the desired message
   *
   * @return Object: nsIURL or nsIMsgMailNewsUrl object
   */
  getUrlFromUriSpec: function(uriSpec) {
    try {
      if (!uriSpec)
        return null;

      let messenger = Cc["@mozilla.org/messenger;1"].getService(Ci.nsIMessenger);
      let msgService = messenger.messageServiceFromURI(uriSpec);

      let url;
      // TB
      let urlObj = {};
      msgService.GetUrlForUri(uriSpec, urlObj, null);

      url = urlObj.value;

      if (url.scheme == "file") {
        return url;
      }
      else {
        return url.QueryInterface(Ci.nsIMsgMailNewsUrl);
      }

    }
    catch (ex) {
      return null;
    }
  },
  /**
   * Copy a file to a mail folder.
   *   in nsIFile aFile,
   *   in nsIMsgFolder dstFolder,
   *   in unsigned long aMsgFlags,
   *   in ACString aMsgKeywords,
   *   in nsIMsgCopyServiceListener listener,
   *   in nsIMsgWindow msgWindow
   */
  copyFileToMailFolder: function(file, destFolder, msgFlags, msgKeywords, listener, msgWindow) {
    let copySvc = Cc["@mozilla.org/messenger/messagecopyservice;1"].getService(Ci.nsIMsgCopyService);

    return copySvc.CopyFileMessage(file, destFolder, null, false, msgFlags, msgKeywords, listener, msgWindow);
  },

  /**
   * Get functions that wrap the changes on nsITreeView between TB 60 and TB 68
   *
   * @param treeObj
   * @param listViewHolder
   *
   * @return {Object}
   */
  getTreeCompatibleFuncs: function(treeObj, listViewHolder) {
    return {
      getCellAt: function(x,y) {
        return treeObj.getCellAt(x, y);
      },
      rowCountChanged: function(a, b) {
        return treeObj.rowCountChanged(a, b);
      },
      invalidate: function() {
        return treeObj.invalidate();
      },
      invalidateRow: function(r) {
        return treeObj.invalidateRow(r);
      }
    };
  },
};
