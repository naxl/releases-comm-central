"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.OutgoingRoomKeyRequestManager = exports.RoomKeyRequestState = void 0;

var _logger = require("../logger");

var _event = require("../@types/event");

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

/**
 * Internal module. Management of outgoing room key requests.
 *
 * See https://docs.google.com/document/d/1m4gQkcnJkxNuBmb5NoFCIadIY-DyqqNAS3lloE73BlQ
 * for draft documentation on what we're supposed to be implementing here.
 *
 * @module
 */
// delay between deciding we want some keys, and sending out the request, to
// allow for (a) it turning up anyway, (b) grouping requests together
const SEND_KEY_REQUESTS_DELAY_MS = 500;
/** possible states for a room key request
 *
 * The state machine looks like:
 *
 *     |         (cancellation sent)
 *     | .-------------------------------------------------.
 *     | |                                                 |
 *     V V       (cancellation requested)                  |
 *   UNSENT  -----------------------------+                |
 *     |                                  |                |
 *     |                                  |                |
 *     | (send successful)                |  CANCELLATION_PENDING_AND_WILL_RESEND
 *     V                                  |                Λ
 *    SENT                                |                |
 *     |--------------------------------  |  --------------'
 *     |                                  |  (cancellation requested with intent
 *     |                                  |   to resend the original request)
 *     |                                  |
 *     | (cancellation requested)         |
 *     V                                  |
 * CANCELLATION_PENDING                   |
 *     |                                  |
 *     | (cancellation sent)              |
 *     V                                  |
 * (deleted)  <---------------------------+
 *
 * @enum {number}
 */

let RoomKeyRequestState;
exports.RoomKeyRequestState = RoomKeyRequestState;

(function (RoomKeyRequestState) {
  RoomKeyRequestState[RoomKeyRequestState["Unsent"] = 0] = "Unsent";
  RoomKeyRequestState[RoomKeyRequestState["Sent"] = 1] = "Sent";
  RoomKeyRequestState[RoomKeyRequestState["CancellationPending"] = 2] = "CancellationPending";
  RoomKeyRequestState[RoomKeyRequestState["CancellationPendingAndWillResend"] = 3] = "CancellationPendingAndWillResend";
})(RoomKeyRequestState || (exports.RoomKeyRequestState = RoomKeyRequestState = {}));

class OutgoingRoomKeyRequestManager {
  // handle for the delayed call to sendOutgoingRoomKeyRequests. Non-null
  // if the callback has been set, or if it is still running.
  // sanity check to ensure that we don't end up with two concurrent runs
  // of sendOutgoingRoomKeyRequests
  constructor(baseApis, deviceId, cryptoStore) {
    this.baseApis = baseApis;
    this.deviceId = deviceId;
    this.cryptoStore = cryptoStore;

    _defineProperty(this, "sendOutgoingRoomKeyRequestsTimer", null);

    _defineProperty(this, "sendOutgoingRoomKeyRequestsRunning", false);

    _defineProperty(this, "clientRunning", false);
  }
  /**
   * Called when the client is started. Sets background processes running.
   */


  start() {
    this.clientRunning = true;
  }
  /**
   * Called when the client is stopped. Stops any running background processes.
   */


  stop() {
    _logger.logger.log('stopping OutgoingRoomKeyRequestManager'); // stop the timer on the next run


    this.clientRunning = false;
  }
  /**
   * Send any requests that have been queued
   */


  sendQueuedRequests() {
    this.startTimer();
  }
  /**
   * Queue up a room key request, if we haven't already queued or sent one.
   *
   * The `requestBody` is compared (with a deep-equality check) against
   * previous queued or sent requests and if it matches, no change is made.
   * Otherwise, a request is added to the pending list, and a job is started
   * in the background to send it.
   *
   * @param {module:crypto~RoomKeyRequestBody} requestBody
   * @param {Array<{userId: string, deviceId: string}>} recipients
   * @param {boolean} resend whether to resend the key request if there is
   *    already one
   *
   * @returns {Promise} resolves when the request has been added to the
   *    pending list (or we have established that a similar request already
   *    exists)
   */


  async queueRoomKeyRequest(requestBody, recipients, resend = false) {
    const req = await this.cryptoStore.getOutgoingRoomKeyRequest(requestBody);

    if (!req) {
      await this.cryptoStore.getOrAddOutgoingRoomKeyRequest({
        requestBody: requestBody,
        recipients: recipients,
        requestId: this.baseApis.makeTxnId(),
        state: RoomKeyRequestState.Unsent
      });
    } else {
      switch (req.state) {
        case RoomKeyRequestState.CancellationPendingAndWillResend:
        case RoomKeyRequestState.Unsent:
          // nothing to do here, since we're going to send a request anyways
          return;

        case RoomKeyRequestState.CancellationPending:
          {
            // existing request is about to be cancelled.  If we want to
            // resend, then change the state so that it resends after
            // cancelling.  Otherwise, just cancel the cancellation.
            const state = resend ? RoomKeyRequestState.CancellationPendingAndWillResend : RoomKeyRequestState.Sent;
            await this.cryptoStore.updateOutgoingRoomKeyRequest(req.requestId, RoomKeyRequestState.CancellationPending, {
              state,
              cancellationTxnId: this.baseApis.makeTxnId()
            });
            break;
          }

        case RoomKeyRequestState.Sent:
          {
            // a request has already been sent.  If we don't want to
            // resend, then do nothing.  If we do want to, then cancel the
            // existing request and send a new one.
            if (resend) {
              const state = RoomKeyRequestState.CancellationPendingAndWillResend;
              const updatedReq = await this.cryptoStore.updateOutgoingRoomKeyRequest(req.requestId, RoomKeyRequestState.Sent, {
                state,
                cancellationTxnId: this.baseApis.makeTxnId(),
                // need to use a new transaction ID so that
                // the request gets sent
                requestTxnId: this.baseApis.makeTxnId()
              });

              if (!updatedReq) {
                // updateOutgoingRoomKeyRequest couldn't find the request
                // in state ROOM_KEY_REQUEST_STATES.SENT, so we must have
                // raced with another tab to mark the request cancelled.
                // Try again, to make sure the request is resent.
                return await this.queueRoomKeyRequest(requestBody, recipients, resend);
              } // We don't want to wait for the timer, so we send it
              // immediately. (We might actually end up racing with the timer,
              // but that's ok: even if we make the request twice, we'll do it
              // with the same transaction_id, so only one message will get
              // sent).
              //
              // (We also don't want to wait for the response from the server
              // here, as it will slow down processing of received keys if we
              // do.)


              try {
                await this.sendOutgoingRoomKeyRequestCancellation(updatedReq, true);
              } catch (e) {
                _logger.logger.error("Error sending room key request cancellation;" + " will retry later.", e);
              } // The request has transitioned from
              // CANCELLATION_PENDING_AND_WILL_RESEND to UNSENT. We
              // still need to resend the request which is now UNSENT, so
              // start the timer if it isn't already started.

            }

            break;
          }

        default:
          throw new Error('unhandled state: ' + req.state);
      }
    }
  }
  /**
   * Cancel room key requests, if any match the given requestBody
   *
   * @param {module:crypto~RoomKeyRequestBody} requestBody
   *
   * @returns {Promise} resolves when the request has been updated in our
   *    pending list.
   */


  cancelRoomKeyRequest(requestBody) {
    return this.cryptoStore.getOutgoingRoomKeyRequest(requestBody).then(req => {
      if (!req) {
        // no request was made for this key
        return;
      }

      switch (req.state) {
        case RoomKeyRequestState.CancellationPending:
        case RoomKeyRequestState.CancellationPendingAndWillResend:
          // nothing to do here
          return;

        case RoomKeyRequestState.Unsent:
          // just delete it
          // FIXME: ghahah we may have attempted to send it, and
          // not yet got a successful response. So the server
          // may have seen it, so we still need to send a cancellation
          // in that case :/
          _logger.logger.log('deleting unnecessary room key request for ' + stringifyRequestBody(requestBody));

          return this.cryptoStore.deleteOutgoingRoomKeyRequest(req.requestId, RoomKeyRequestState.Unsent);

        case RoomKeyRequestState.Sent:
          {
            // send a cancellation.
            return this.cryptoStore.updateOutgoingRoomKeyRequest(req.requestId, RoomKeyRequestState.Sent, {
              state: RoomKeyRequestState.CancellationPending,
              cancellationTxnId: this.baseApis.makeTxnId()
            }).then(updatedReq => {
              if (!updatedReq) {
                // updateOutgoingRoomKeyRequest couldn't find the
                // request in state ROOM_KEY_REQUEST_STATES.SENT,
                // so we must have raced with another tab to mark
                // the request cancelled. There is no point in
                // sending another cancellation since the other tab
                // will do it.
                _logger.logger.log('Tried to cancel room key request for ' + stringifyRequestBody(requestBody) + ' but it was already cancelled in another tab');

                return;
              } // We don't want to wait for the timer, so we send it
              // immediately. (We might actually end up racing with the timer,
              // but that's ok: even if we make the request twice, we'll do it
              // with the same transaction_id, so only one message will get
              // sent).
              //
              // (We also don't want to wait for the response from the server
              // here, as it will slow down processing of received keys if we
              // do.)


              this.sendOutgoingRoomKeyRequestCancellation(updatedReq).catch(e => {
                _logger.logger.error("Error sending room key request cancellation;" + " will retry later.", e);

                this.startTimer();
              });
            });
          }

        default:
          throw new Error('unhandled state: ' + req.state);
      }
    });
  }
  /**
   * Look for room key requests by target device and state
   *
   * @param {string} userId Target user ID
   * @param {string} deviceId Target device ID
   *
   * @return {Promise} resolves to a list of all the
   *    {@link module:crypto/store/base~OutgoingRoomKeyRequest}
   */


  getOutgoingSentRoomKeyRequest(userId, deviceId) {
    return this.cryptoStore.getOutgoingRoomKeyRequestsByTarget(userId, deviceId, [RoomKeyRequestState.Sent]);
  }
  /**
   * Find anything in `sent` state, and kick it around the loop again.
   * This is intended for situations where something substantial has changed, and we
   * don't really expect the other end to even care about the cancellation.
   * For example, after initialization or self-verification.
   * @return {Promise} An array of `queueRoomKeyRequest` outputs.
   */


  async cancelAndResendAllOutgoingRequests() {
    const outgoings = await this.cryptoStore.getAllOutgoingRoomKeyRequestsByState(RoomKeyRequestState.Sent);
    return Promise.all(outgoings.map(({
      requestBody,
      recipients
    }) => this.queueRoomKeyRequest(requestBody, recipients, true)));
  } // start the background timer to send queued requests, if the timer isn't
  // already running


  startTimer() {
    if (this.sendOutgoingRoomKeyRequestsTimer) {
      return;
    }

    const startSendingOutgoingRoomKeyRequests = () => {
      if (this.sendOutgoingRoomKeyRequestsRunning) {
        throw new Error("RoomKeyRequestSend already in progress!");
      }

      this.sendOutgoingRoomKeyRequestsRunning = true;
      this.sendOutgoingRoomKeyRequests().finally(() => {
        this.sendOutgoingRoomKeyRequestsRunning = false;
      }).catch(e => {
        // this should only happen if there is an indexeddb error,
        // in which case we're a bit stuffed anyway.
        _logger.logger.warn(`error in OutgoingRoomKeyRequestManager: ${e}`);
      });
    };

    this.sendOutgoingRoomKeyRequestsTimer = setTimeout(startSendingOutgoingRoomKeyRequests, SEND_KEY_REQUESTS_DELAY_MS);
  } // look for and send any queued requests. Runs itself recursively until
  // there are no more requests, or there is an error (in which case, the
  // timer will be restarted before the promise resolves).


  sendOutgoingRoomKeyRequests() {
    if (!this.clientRunning) {
      this.sendOutgoingRoomKeyRequestsTimer = null;
      return Promise.resolve();
    }

    return this.cryptoStore.getOutgoingRoomKeyRequestByState([RoomKeyRequestState.CancellationPending, RoomKeyRequestState.CancellationPendingAndWillResend, RoomKeyRequestState.Unsent]).then(req => {
      if (!req) {
        this.sendOutgoingRoomKeyRequestsTimer = null;
        return;
      }

      let prom;

      switch (req.state) {
        case RoomKeyRequestState.Unsent:
          prom = this.sendOutgoingRoomKeyRequest(req);
          break;

        case RoomKeyRequestState.CancellationPending:
          prom = this.sendOutgoingRoomKeyRequestCancellation(req);
          break;

        case RoomKeyRequestState.CancellationPendingAndWillResend:
          prom = this.sendOutgoingRoomKeyRequestCancellation(req, true);
          break;
      }

      return prom.then(() => {
        // go around the loop again
        return this.sendOutgoingRoomKeyRequests();
      }).catch(e => {
        _logger.logger.error("Error sending room key request; will retry later.", e);

        this.sendOutgoingRoomKeyRequestsTimer = null;
      });
    });
  } // given a RoomKeyRequest, send it and update the request record


  sendOutgoingRoomKeyRequest(req) {
    _logger.logger.log(`Requesting keys for ${stringifyRequestBody(req.requestBody)}` + ` from ${stringifyRecipientList(req.recipients)}` + `(id ${req.requestId})`);

    const requestMessage = {
      action: "request",
      requesting_device_id: this.deviceId,
      request_id: req.requestId,
      body: req.requestBody
    };
    return this.sendMessageToDevices(requestMessage, req.recipients, req.requestTxnId || req.requestId).then(() => {
      return this.cryptoStore.updateOutgoingRoomKeyRequest(req.requestId, RoomKeyRequestState.Unsent, {
        state: RoomKeyRequestState.Sent
      });
    });
  } // Given a RoomKeyRequest, cancel it and delete the request record unless
  // andResend is set, in which case transition to UNSENT.


  sendOutgoingRoomKeyRequestCancellation(req, andResend = false) {
    _logger.logger.log(`Sending cancellation for key request for ` + `${stringifyRequestBody(req.requestBody)} to ` + `${stringifyRecipientList(req.recipients)} ` + `(cancellation id ${req.cancellationTxnId})`);

    const requestMessage = {
      action: "request_cancellation",
      requesting_device_id: this.deviceId,
      request_id: req.requestId
    };
    return this.sendMessageToDevices(requestMessage, req.recipients, req.cancellationTxnId).then(() => {
      if (andResend) {
        // We want to resend, so transition to UNSENT
        return this.cryptoStore.updateOutgoingRoomKeyRequest(req.requestId, RoomKeyRequestState.CancellationPendingAndWillResend, {
          state: RoomKeyRequestState.Unsent
        });
      }

      return this.cryptoStore.deleteOutgoingRoomKeyRequest(req.requestId, RoomKeyRequestState.CancellationPending);
    });
  } // send a RoomKeyRequest to a list of recipients


  sendMessageToDevices(message, recipients, txnId) {
    const contentMap = {};

    for (const recip of recipients) {
      if (!contentMap[recip.userId]) {
        contentMap[recip.userId] = {};
      }

      contentMap[recip.userId][recip.deviceId] = message;
    }

    return this.baseApis.sendToDevice(_event.EventType.RoomKeyRequest, contentMap, txnId);
  }

}

exports.OutgoingRoomKeyRequestManager = OutgoingRoomKeyRequestManager;

function stringifyRequestBody(requestBody) {
  // we assume that the request is for megolm keys, which are identified by
  // room id and session id
  return requestBody.room_id + " / " + requestBody.session_id;
}

function stringifyRecipientList(recipients) {
  return '[' + recipients.map(r => `${r.userId}:${r.deviceId}`).join(",") + ']';
}