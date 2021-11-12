/* vim: set ts=2 sw=2 et tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const EXPORTED_SYMBOLS = ["MailtoChild"];

class MailtoChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.button == 0 && event.target.href.startsWith("mailto:")) {
      this.sendAsyncMessage("mailtoLink", event.target.href);
      event.preventDefault();
    }
  }
}
