/* -*- Mode: indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* vim: set sts=2 sw=2 et tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

ChromeUtils.defineModuleGetter(
  this,
  "MailExtensionShortcuts",
  "resource:///modules/MailExtensionShortcuts.jsm"
);

this.commands = class extends ExtensionAPI {
  static onUninstall(extensionId) {
    return MailExtensionShortcuts.removeCommandsFromStorage(extensionId);
  }

  async onManifestEntry(entryName) {
    let shortcuts = new MailExtensionShortcuts({
      extension: this.extension,
      onCommand: name => this.emit("command", name),
    });
    this.extension.shortcuts = shortcuts;
    await shortcuts.loadCommands();
    await shortcuts.register();
  }

  onShutdown() {
    this.extension.shortcuts.unregister();
  }

  getAPI(context) {
    return {
      commands: {
        getAll: () => this.extension.shortcuts.allCommands(),
        update: args => this.extension.shortcuts.updateCommand(args),
        reset: name => this.extension.shortcuts.resetCommand(name),
        onCommand: new EventManager({
          context,
          name: "commands.onCommand",
          inputHandling: true,
          register: fire => {
            let listener = (eventName, commandName) => {
              let tab = context.extension.tabManager.convert(
                tabTracker.activeTab
              );
              fire.async(commandName, tab);
            };
            this.on("command", listener);
            return () => {
              this.off("command", listener);
            };
          },
        }).api(),
      },
    };
  }
};
