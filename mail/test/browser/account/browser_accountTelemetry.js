/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

/**
 * Test telemetry related to account.
 */

let { FeedUtils } = ChromeUtils.import("resource:///modules/FeedUtils.jsm");
let { FileUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/FileUtils.sys.mjs"
);
let { IMServices } = ChromeUtils.import("resource:///modules/IMServices.jsm");
let { MailServices } = ChromeUtils.import(
  "resource:///modules/MailServices.jsm"
);
let { MailTelemetryForTests } = ChromeUtils.import(
  "resource:///modules/MailGlue.jsm"
);

let {
  add_message_to_folder,
  create_message,
  msgGen,
  get_special_folder,
  create_folder,
} = ChromeUtils.import(
  "resource://testing-common/mozmill/FolderDisplayHelpers.jsm"
);
let { PromiseTestUtils } = ChromeUtils.import(
  "resource://testing-common/mailnews/PromiseTestUtils.jsm"
);
let { TelemetryTestUtils } = ChromeUtils.import(
  "resource://testing-common/TelemetryTestUtils.jsm"
);

// Collect all added accounts to be cleaned up at the end.
let addedAccounts = [];

/**
 * Check that we are counting account types.
 */
add_task(async function test_account_types() {
  Services.telemetry.clearScalars();

  const NUM_IMAP = 3;
  const NUM_RSS = 1;
  const NUM_IRC = 1;

  // Add incoming servers.
  let imapServer = MailServices.accounts
    .createIncomingServer("nobody", "foo.invalid", "imap")
    .QueryInterface(Ci.nsIImapIncomingServer);
  let imAccount = IMServices.accounts.createAccount(
    "telemetry-irc-user",
    "prpl-irc"
  );
  imAccount.autoLogin = false;
  let ircServer = MailServices.accounts.createIncomingServer(
    "nobody",
    "foo.invalid",
    "im"
  );
  ircServer.wrappedJSObject.imAccount = imAccount;

  // Add accounts and assign incoming servers.
  for (let i = 0; i < NUM_IMAP; i++) {
    let identity = MailServices.accounts.createIdentity();
    identity.email = "tinderbox@foo.invalid";
    let account = MailServices.accounts.createAccount();
    account.incomingServer = imapServer;
    account.addIdentity(identity);
    addedAccounts.push(account);
  }
  for (let i = 0; i < NUM_RSS; i++) {
    let account = FeedUtils.createRssAccount("rss");
    addedAccounts.push(account);
  }
  for (let i = 0; i < NUM_IRC; i++) {
    let account = MailServices.accounts.createAccount();
    account.incomingServer = ircServer;
    addedAccounts.push(account);
  }

  MailTelemetryForTests.reportAccountTypes();
  let scalars = TelemetryTestUtils.getProcessScalars("parent", true);

  // Check if we count account types correctly.
  Assert.equal(
    scalars["tb.account.count"].imap,
    NUM_IMAP,
    "IMAP account number must be correct"
  );
  Assert.equal(
    scalars["tb.account.count"].rss,
    NUM_RSS,
    "RSS account number must be correct"
  );
  Assert.equal(
    scalars["tb.account.count"].im_irc,
    NUM_IRC,
    "IRC account number must be correct"
  );
  Assert.equal(
    scalars["tb.account.count"].none,
    undefined,
    "Should not report Local Folders account"
  );

  for (let account of addedAccounts) {
    MailServices.accounts.removeAccount(account);
  }
});

/**
 * Check that we are counting account sizes.
 */
add_task(async function test_account_sizes() {
  Services.telemetry.clearScalars();

  const NUM_INBOX = 3;
  const NUM_OTHER = 2;

  let inbox = await get_special_folder(
    Ci.nsMsgFolderFlags.Inbox,
    true,
    null,
    false
  );
  let other = await create_folder("TestAccountSize");
  for (let i = 0; i < NUM_INBOX; i++) {
    await add_message_to_folder(
      [inbox],
      msgGen.makeMessage({ body: { body: `test inbox ${i}` } })
    );
  }
  for (let i = 0; i < NUM_OTHER; i++) {
    await add_message_to_folder(
      [other],
      msgGen.makeMessage({ body: { body: `test other ${i}` } })
    );
  }

  MailTelemetryForTests.reportAccountSizes();
  let scalars = TelemetryTestUtils.getProcessScalars("parent", true);

  // Check if we count total messages correctly.
  Assert.equal(
    scalars["tb.account.total_messages"].Inbox,
    NUM_INBOX,
    "Number of messages in Inbox must be correct"
  );
  Assert.equal(
    scalars["tb.account.total_messages"].Other,
    NUM_OTHER,
    "Number of messages in other folders must be correct"
  );
  Assert.equal(
    scalars["tb.account.total_messages"].Total,
    NUM_INBOX + NUM_OTHER,
    "Number of messages in all folders must be correct"
  );

  // The folder sizes on Windows are not exactly the same with Linux/macOS.
  function checkSize(actual, expected, message) {
    Assert.ok(Math.abs(actual - expected) < 10, message);
  }
  // Check if we count size on disk correctly.
  checkSize(
    scalars["tb.account.size_on_disk"].Inbox,
    873,
    "Size of Inbox must be correct"
  );
  checkSize(
    scalars["tb.account.size_on_disk"].Other,
    618,
    "Size of other folders must be correct"
  );
  checkSize(
    scalars["tb.account.size_on_disk"].Total,
    873 + 618,
    "Size of all folders must be correct"
  );
});
