/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function run_test() {
  do_calendar_startup(run_next_test);
}

/**
 * Checks whether the passed string is a valid tz version number
 * @param    {String}         aVersionString
 * @returns  {boolean}
 */
function valid_tz_version(aVersionString) {
  return aVersionString.match(/^2\.(\d{4})(z*[a-z])$/);
}

// check tz database version
add_task(async function version_test() {
  ok(valid_tz_version(cal.timezoneService.version), "timezone version");
});

// check whether all tz definitions have all properties
add_task(async function zone_test() {
  function resolveZone(aZoneId) {
    let timezone = cal.timezoneService.getTimezone(aZoneId);
    equal(aZoneId, timezone.tzid, "Zone test " + aZoneId);
    ok(
      timezone.icalComponent.serializeToICS().startsWith("BEGIN:VTIMEZONE"),
      "VTIMEZONE test " + aZoneId
    );
    ok(timezone.latitude && !!timezone.latitude.match(/^[+-]\d{7}$/), "Latitude test " + aZoneId);
    ok(
      timezone.longitude && !!timezone.longitude.match(/^[+-]\d{7}$/),
      "Longitude test " + aZoneId
    );
  }

  let foundZone = false;
  for (let zone of cal.timezoneService.timezoneIds) {
    foundZone = true;
    resolveZone(zone);
  }

  ok(foundZone, "There is at least one timezone");
});

// Check completeness to avoid unintended removing of zones/aliases when updating zones.json
// removed zones should at least remain as alias to not break UI like in bug 1210723.
// previous.json is generated automatically by executing update-zones.py script
add_task(async function completeness_test() {
  let jsonFile = do_get_file("data/previous.json");
  let test = readJSONFile(jsonFile);
  ok(test, "previous.json was loaded for completeness test");

  if (test) {
    // we check for valid version number of test data only - version number of tzs.version was
    // already checked in a separate test
    ok(valid_tz_version(test.version), "test data version.");
    // update-zones.py may create a dummy set of test data based on the current tz version for
    // convenience, that must not be used without being modified manually to comply with a
    // previous tz version.
    notEqual(test.version, "2.1969z", "Check for dummy test data.");
    let comp = Services.vc.compare(test.version, cal.timezoneService.version);

    // some checks on the test data
    if (comp != -1) {
      switch (comp) {
        case 0:
          info("Test data and timezone service use the same timezone version.");
          break;
        case 1:
          info("Test data use a newer timezone version than the timezone service.");
          break;
      }
      info("test data: " + test.version);
      info("tz service: " + cal.timezoneService.version);
      info(
        "This indicates a problem in update-zones.py or manually additions to" +
          "zones.json or previous.json"
      );
    }
    equal(comp, -1, "timezone version of test data is older than the currently used version.");
    ok(test.aliases && test.aliases.length > 0, "test data have aliases.");
    ok(test.zones && test.zones.length > 0, "test data have zones.");

    // completeness check for aliases and zones (this covers also cases, when a previous zone
    // definition got transformed into alias linked to a valid zone - so, there's no need for
    // separate test step to cover that)
    for (let alias of test.aliases) {
      notEqual(
        cal.timezoneService.getTimezone(alias),
        null,
        "Test Alias " + alias + " from " + test.version
      );
    }
    for (let zone of test.zones) {
      notEqual(
        cal.timezoneService.getTimezone(zone),
        null,
        "Test Zone " + zone + " from " + test.version
      );
    }
  }
});
