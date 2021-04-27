/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

var { registerTestProtocol, unregisterTestProtocol } = ChromeUtils.import(
  "resource://testing-common/TestProtocol.jsm"
);
var { Services } = ChromeUtils.import("resource:///modules/imServices.jsm");

async function openChatTab() {
  let tabmail = document.getElementById("tabmail");
  let chatMode = tabmail.tabModes.chat;

  if (chatMode.tabs.length == 1) {
    tabmail.selectedTab = chatMode.tabs[0];
  } else {
    window.showChatTab();
  }

  is(chatMode.tabs.length, 1, "chat tab is open");
  is(tabmail.selectedTab, chatMode.tabs[0], "chat tab is selected");

  await new Promise(resolve => setTimeout(resolve));
}

async function closeChatTab() {
  let tabmail = document.getElementById("tabmail");
  let chatMode = tabmail.tabModes.chat;

  if (chatMode.tabs.length == 1) {
    tabmail.closeTab(chatMode.tabs[0]);
  }

  is(chatMode.tabs.length, 0, "chat tab is not open");

  await new Promise(resolve => setTimeout(resolve));
}

registerTestProtocol();

registerCleanupFunction(async () => {
  // Make sure the chat state is clean
  await closeChatTab();

  const conversations = Services.conversations.getConversations();
  is(conversations.length, 0, "All conversations were closed by their test");
  for (const conversation of conversations) {
    try {
      conversation.close();
    } catch (error) {
      ok(false, error.message);
    }
  }

  const accounts = Services.accounts.getAccounts();
  is(accounts.length, 0, "All accounts were removed by their test");
  for (const account of accounts) {
    try {
      if (account.connected || account.connecting) {
        account.disconnect();
      }
      Services.accounts.deleteAccount(account.id);
    } catch (error) {
      ok(false, "Error deleting account " + account.id + ": " + error.message);
    }
  }

  unregisterTestProtocol();
});