"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RemoteIndexedDBStoreBackend = void 0;

var _logger = require("../logger");

var _utils = require("../utils");

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

class RemoteIndexedDBStoreBackend {
  // The currently in-flight requests to the actual backend
  // seq: promise
  // Once we start connecting, we keep the promise and re-use it
  // if we try to connect again

  /**
   * An IndexedDB store backend where the actual backend sits in a web
   * worker.
   *
   * Construct a new Indexed Database store backend. This requires a call to
   * <code>connect()</code> before this store can be used.
   * @constructor
   * @param {Function} workerFactory Factory which produces a Worker
   * @param {string=} dbName Optional database name. The same name must be used
   * to open the same database.
   */
  constructor(workerFactory, dbName) {
    this.workerFactory = workerFactory;
    this.dbName = dbName;

    _defineProperty(this, "worker", void 0);

    _defineProperty(this, "nextSeq", 0);

    _defineProperty(this, "inFlight", {});

    _defineProperty(this, "startPromise", null);

    _defineProperty(this, "onWorkerMessage", ev => {
      const msg = ev.data;

      if (msg.command == 'cmd_success' || msg.command == 'cmd_fail') {
        if (msg.seq === undefined) {
          _logger.logger.error("Got reply from worker with no seq");

          return;
        }

        const def = this.inFlight[msg.seq];

        if (def === undefined) {
          _logger.logger.error("Got reply for unknown seq " + msg.seq);

          return;
        }

        delete this.inFlight[msg.seq];

        if (msg.command == 'cmd_success') {
          def.resolve(msg.result);
        } else {
          const error = new Error(msg.error.message);
          error.name = msg.error.name;
          def.reject(error);
        }
      } else {
        _logger.logger.warn("Unrecognised message from worker: ", msg);
      }
    });
  }
  /**
   * Attempt to connect to the database. This can fail if the user does not
   * grant permission.
   * @return {Promise} Resolves if successfully connected.
   */


  connect() {
    return this.ensureStarted().then(() => this.doCmd('connect'));
  }
  /**
   * Clear the entire database. This should be used when logging out of a client
   * to prevent mixing data between accounts.
   * @return {Promise} Resolved when the database is cleared.
   */


  clearDatabase() {
    return this.ensureStarted().then(() => this.doCmd('clearDatabase'));
  }
  /** @return {Promise<boolean>} whether or not the database was newly created in this session. */


  isNewlyCreated() {
    return this.doCmd('isNewlyCreated');
  }
  /**
   * @return {Promise} Resolves with a sync response to restore the
   * client state to where it was at the last save, or null if there
   * is no saved sync data.
   */


  getSavedSync() {
    return this.doCmd('getSavedSync');
  }

  getNextBatchToken() {
    return this.doCmd('getNextBatchToken');
  }

  setSyncData(syncData) {
    return this.doCmd('setSyncData', [syncData]);
  }

  syncToDatabase(userTuples) {
    return this.doCmd('syncToDatabase', [userTuples]);
  }
  /**
   * Returns the out-of-band membership events for this room that
   * were previously loaded.
   * @param {string} roomId
   * @returns {event[]} the events, potentially an empty array if OOB loading didn't yield any new members
   * @returns {null} in case the members for this room haven't been stored yet
   */


  getOutOfBandMembers(roomId) {
    return this.doCmd('getOutOfBandMembers', [roomId]);
  }
  /**
   * Stores the out-of-band membership events for this room. Note that
   * it still makes sense to store an empty array as the OOB status for the room is
   * marked as fetched, and getOutOfBandMembers will return an empty array instead of null
   * @param {string} roomId
   * @param {event[]} membershipEvents the membership events to store
   * @returns {Promise} when all members have been stored
   */


  setOutOfBandMembers(roomId, membershipEvents) {
    return this.doCmd('setOutOfBandMembers', [roomId, membershipEvents]);
  }

  clearOutOfBandMembers(roomId) {
    return this.doCmd('clearOutOfBandMembers', [roomId]);
  }

  getClientOptions() {
    return this.doCmd('getClientOptions');
  }

  storeClientOptions(options) {
    return this.doCmd('storeClientOptions', [options]);
  }
  /**
   * Load all user presence events from the database. This is not cached.
   * @return {Promise<Object[]>} A list of presence events in their raw form.
   */


  getUserPresenceEvents() {
    return this.doCmd('getUserPresenceEvents');
  }

  async saveToDeviceBatches(batches) {
    return this.doCmd('saveToDeviceBatches', [batches]);
  }

  async getOldestToDeviceBatch() {
    return this.doCmd('getOldestToDeviceBatch');
  }

  async removeToDeviceBatch(id) {
    return this.doCmd('removeToDeviceBatch', [id]);
  }

  ensureStarted() {
    if (this.startPromise === null) {
      this.worker = this.workerFactory();
      this.worker.onmessage = this.onWorkerMessage; // tell the worker the db name.

      this.startPromise = this.doCmd('_setupWorker', [this.dbName]).then(() => {
        _logger.logger.log("IndexedDB worker is ready");
      });
    }

    return this.startPromise;
  }

  doCmd(command, args) {
    // wrap in a q so if the postMessage throws,
    // the promise automatically gets rejected
    return Promise.resolve().then(() => {
      const seq = this.nextSeq++;
      const def = (0, _utils.defer)();
      this.inFlight[seq] = def;
      this.worker.postMessage({
        command,
        seq,
        args
      });
      return def.promise;
    });
  }

}

exports.RemoteIndexedDBStoreBackend = RemoteIndexedDBStoreBackend;