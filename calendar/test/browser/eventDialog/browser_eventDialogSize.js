/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var {
  CALENDARNAME,
  closeAllEventDialogs,
  controller,
  createCalendar,
  deleteCalendars,
  helpersForController,
  invokeNewEventDialog,
} = ChromeUtils.import("resource://testing-common/mozmill/CalendarUtils.jsm");

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

const SMALL_TOLERANCE = 5;
const LARGE_TOLERANCE = 10;

add_task(function setupModule(module) {
  createCalendar(controller, CALENDARNAME);
});

add_task(async function testEventDialog() {
  info("#calendar-new-event-menuitem click");
  controller.mainMenu.click("#calendar-new-event-menuitem");
  await invokeNewEventDialog(controller, null, (event, iframe) => {
    checkLargeEnough(event, iframe);

    // Much larger than necessary.
    event.window.resizeTo(650, 690);
    checkWithinTolerance(event.window.outerWidth, 650);
    checkWithinTolerance(event.window.outerHeight, 690);
    EventUtils.synthesizeKey("VK_ESCAPE", {}, event.window);
  });

  checkWithinTolerance(getPersistedValue("width"), 650, LARGE_TOLERANCE);
  checkWithinTolerance(getPersistedValue("height"), 690, LARGE_TOLERANCE);

  info("#calendar-new-event-menuitem click");
  controller.mainMenu.click("#calendar-new-event-menuitem");
  await invokeNewEventDialog(controller, null, (event, iframe) => {
    let eventDocEl = event.window.document.documentElement;

    checkWithinTolerance(event.window.outerWidth, 650, LARGE_TOLERANCE);
    checkWithinTolerance(event.window.outerHeight, 690, LARGE_TOLERANCE);
    checkLargeEnough(event, iframe);

    // Much smaller than necessary.
    event.window.resizeTo(350, 400);
    checkLargeEnough(event, iframe);
    Assert.less(event.window.outerWidth, 650, "dialog shrank");
    Assert.less(event.window.outerHeight, 690, "dialog shrank");
    Assert.greater(event.window.outerWidth, 350, "requested size not reached");
    Assert.greater(event.window.outerHeight, 400, "requested size not reached");
    Assert.equal(
      eventDocEl.getAttribute("minwidth"),
      eventDocEl.getAttribute("width"),
      "minimum width attribute set"
    );
    Assert.equal(
      eventDocEl.getAttribute("minheight"),
      eventDocEl.getAttribute("height"),
      "minimum height attribute set"
    );
    EventUtils.synthesizeKey("VK_ESCAPE", {}, event.window);
  });

  info("#calendar-new-event-menuitem click");
  controller.mainMenu.click("#calendar-new-event-menuitem");
  await invokeNewEventDialog(controller, null, (event, iframe) => {
    checkLargeEnough(event, iframe);

    // Much larger than necessary.
    event.window.resizeTo(650, 690);
    checkWithinTolerance(event.window.outerWidth, 650);
    checkWithinTolerance(event.window.outerHeight, 690);
    EventUtils.synthesizeKey("VK_ESCAPE", {}, event.window);
  });

  checkWithinTolerance(getPersistedValue("width"), 650, LARGE_TOLERANCE);
  checkWithinTolerance(getPersistedValue("height"), 690, LARGE_TOLERANCE);
});

add_task(async function testTaskDialog() {
  info("#calendar-new-task-menuitem click");
  controller.mainMenu.click("#calendar-new-task-menuitem");

  await invokeNewEventDialog(controller, null, (task, iframe) => {
    checkWithinTolerance(getPersistedValue("width"), 650, LARGE_TOLERANCE);
    checkWithinTolerance(getPersistedValue("height"), 690, LARGE_TOLERANCE);

    checkLargeEnough(task, iframe);

    // Much larger than necessary.
    task.window.resizeTo(680, 700);
    checkWithinTolerance(task.window.outerWidth, 680);
    checkWithinTolerance(task.window.outerHeight, 700);
    EventUtils.synthesizeKey("VK_ESCAPE", {}, task.window);
  });

  checkWithinTolerance(getPersistedValue("width"), 680, LARGE_TOLERANCE);
  checkWithinTolerance(getPersistedValue("height"), 700, LARGE_TOLERANCE);

  info("#calendar-new-task-menuitem click");
  controller.mainMenu.click("#calendar-new-task-menuitem");
  await invokeNewEventDialog(controller, null, (task, iframe) => {
    let taskDocEl = task.window.document.documentElement;

    checkWithinTolerance(task.window.outerWidth, 680, LARGE_TOLERANCE);
    checkWithinTolerance(task.window.outerHeight, 700, LARGE_TOLERANCE);
    checkLargeEnough(task, iframe);

    // Much smaller than necessary.
    task.window.resizeTo(350, 400);
    checkLargeEnough(task, iframe);
    Assert.less(task.window.outerWidth, 680, "dialog shrank");
    Assert.less(task.window.outerHeight, 700, "dialog shrank");
    Assert.greater(task.window.outerWidth, 350, "minimum size not reached");
    Assert.greater(task.window.outerHeight, 400, "minimum size not reached");
    Assert.equal(
      taskDocEl.getAttribute("minwidth"),
      taskDocEl.getAttribute("width"),
      "minimum width attribute set"
    );
    Assert.equal(
      taskDocEl.getAttribute("minheight"),
      taskDocEl.getAttribute("height"),
      "minimum height attribute set"
    );
    EventUtils.synthesizeKey("VK_ESCAPE", {}, task.window);
  });

  info("#calendar-new-task-menuitem click");
  controller.mainMenu.click("#calendar-new-task-menuitem");
  await invokeNewEventDialog(controller, null, (task, iframe) => {
    checkLargeEnough(task, iframe);

    // Much larger than necessary.
    task.window.resizeTo(680, 700);
    checkWithinTolerance(task.window.outerWidth, 680);
    checkWithinTolerance(task.window.outerHeight, 700);
    EventUtils.synthesizeKey("VK_ESCAPE", {}, task.window);
  });
});

registerCleanupFunction(function teardownModule(module) {
  deleteCalendars(controller, CALENDARNAME);
  closeAllEventDialogs();
});

// Check the dialog is resized large enough to hold the iframe.
function checkLargeEnough(outer, inner) {
  let { eid: outerId } = helpersForController(outer);

  let iframeNode = outerId("lightning-item-panel-iframe").getNode();
  let { scrollWidth, scrollHeight } = inner.window.document.documentElement;
  outer.waitFor(() => {
    return (
      iframeNode.clientWidth + SMALL_TOLERANCE >= scrollWidth &&
      iframeNode.clientHeight + SMALL_TOLERANCE >= scrollHeight
    );
  });
  info(`Dialog is ${outer.window.outerWidth} by ${outer.window.outerHeight}`);
}

function getPersistedValue(which) {
  return Services.xulStore.getValue(
    "chrome://calendar/content/calendar-event-dialog.xhtml",
    "calendar-event-window",
    which
  );
}

function checkWithinTolerance(value, expected, tolerance = 1) {
  if (controller.window.devicePixelRatio == 1) {
    Assert.equal(value, expected);
    return;
  }
  // In an environment where the display is scaled, rounding errors can cause
  // problems with exact tests. The mechanism for persisting and restoring
  // window sizes also appears to be buggy, so we account for that by
  // increasing the tolerance.
  Assert.lessOrEqual(Math.abs(value - expected), tolerance);
}
