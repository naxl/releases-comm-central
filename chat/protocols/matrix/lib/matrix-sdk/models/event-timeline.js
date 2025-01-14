"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.EventTimeline = exports.Direction = void 0;

var _logger = require("../logger");

var _roomState = require("./room-state");

var _event = require("../@types/event");

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

let Direction;
exports.Direction = Direction;

(function (Direction) {
  Direction["Backward"] = "b";
  Direction["Forward"] = "f";
})(Direction || (exports.Direction = Direction = {}));

class EventTimeline {
  /**
   * Symbolic constant for methods which take a 'direction' argument:
   * refers to the start of the timeline, or backwards in time.
   */

  /**
   * Symbolic constant for methods which take a 'direction' argument:
   * refers to the end of the timeline, or forwards in time.
   */

  /**
   * Static helper method to set sender and target properties
   *
   * @param {MatrixEvent} event   the event whose metadata is to be set
   * @param {RoomState} stateContext  the room state to be queried
   * @param {boolean} toStartOfTimeline  if true the event's forwardLooking flag is set false
   */
  static setEventMetadata(event, stateContext, toStartOfTimeline) {
    // When we try to generate a sentinel member before we have that member
    // in the members object, we still generate a sentinel but it doesn't
    // have a membership event, so test to see if events.member is set. We
    // check this to avoid overriding non-sentinel members by sentinel ones
    // when adding the event to a filtered timeline
    if (!event.sender?.events?.member) {
      event.sender = stateContext.getSentinelMember(event.getSender());
    }

    if (!event.target?.events?.member && event.getType() === _event.EventType.RoomMember) {
      event.target = stateContext.getSentinelMember(event.getStateKey());
    }

    if (event.isState()) {
      // room state has no concept of 'old' or 'current', but we want the
      // room state to regress back to previous values if toStartOfTimeline
      // is set, which means inspecting prev_content if it exists. This
      // is done by toggling the forwardLooking flag.
      if (toStartOfTimeline) {
        event.forwardLooking = false;
      }
    }
  }

  /**
   * Construct a new EventTimeline
   *
   * <p>An EventTimeline represents a contiguous sequence of events in a room.
   *
   * <p>As well as keeping track of the events themselves, it stores the state of
   * the room at the beginning and end of the timeline, and pagination tokens for
   * going backwards and forwards in the timeline.
   *
   * <p>In order that clients can meaningfully maintain an index into a timeline,
   * the EventTimeline object tracks a 'baseIndex'. This starts at zero, but is
   * incremented when events are prepended to the timeline. The index of an event
   * relative to baseIndex therefore remains constant.
   *
   * <p>Once a timeline joins up with its neighbour, they are linked together into a
   * doubly-linked list.
   *
   * @param {EventTimelineSet} eventTimelineSet the set of timelines this is part of
   * @constructor
   */
  constructor(eventTimelineSet) {
    this.eventTimelineSet = eventTimelineSet;

    _defineProperty(this, "roomId", void 0);

    _defineProperty(this, "name", void 0);

    _defineProperty(this, "events", []);

    _defineProperty(this, "baseIndex", 0);

    _defineProperty(this, "startState", void 0);

    _defineProperty(this, "endState", void 0);

    _defineProperty(this, "prevTimeline", void 0);

    _defineProperty(this, "nextTimeline", void 0);

    _defineProperty(this, "paginationRequests", {
      [Direction.Backward]: null,
      [Direction.Forward]: null
    });

    this.roomId = eventTimelineSet.room?.roomId ?? null;
    this.startState = new _roomState.RoomState(this.roomId);
    this.startState.paginationToken = null;
    this.endState = new _roomState.RoomState(this.roomId);
    this.endState.paginationToken = null;
    this.prevTimeline = null;
    this.nextTimeline = null; // this is used by client.js

    this.paginationRequests = {
      'b': null,
      'f': null
    };
    this.name = this.roomId + ":" + new Date().toISOString();
  }
  /**
   * Initialise the start and end state with the given events
   *
   * <p>This can only be called before any events are added.
   *
   * @param {MatrixEvent[]} stateEvents list of state events to initialise the
   * state with.
   * @throws {Error} if an attempt is made to call this after addEvent is called.
   */


  initialiseState(stateEvents, {
    timelineWasEmpty
  } = {}) {
    if (this.events.length > 0) {
      throw new Error("Cannot initialise state after events are added");
    } // We previously deep copied events here and used different copies in
    // the oldState and state events: this decision seems to date back
    // quite a way and was apparently made to fix a bug where modifications
    // made to the start state leaked through to the end state.
    // This really shouldn't be possible though: the events themselves should
    // not change. Duplicating the events uses a lot of extra memory,
    // so we now no longer do it. To assert that they really do never change,
    // freeze them! Note that we can't do this for events in general:
    // although it looks like the only things preventing us are the
    // 'status' flag, forwardLooking (which is only set once when adding to the
    // timeline) and possibly the sender (which seems like it should never be
    // reset but in practice causes a lot of the tests to break).


    for (const e of stateEvents) {
      Object.freeze(e);
    }

    this.startState.setStateEvents(stateEvents, {
      timelineWasEmpty
    });
    this.endState.setStateEvents(stateEvents, {
      timelineWasEmpty
    });
  }
  /**
   * Forks the (live) timeline, taking ownership of the existing directional state of this timeline.
   * All attached listeners will keep receiving state updates from the new live timeline state.
   * The end state of this timeline gets replaced with an independent copy of the current RoomState,
   * and will need a new pagination token if it ever needs to paginate forwards.
    * @param {string} direction   EventTimeline.BACKWARDS to get the state at the
   *   start of the timeline; EventTimeline.FORWARDS to get the state at the end
   *   of the timeline.
   *
   * @return {EventTimeline} the new timeline
   */


  forkLive(direction) {
    const forkState = this.getState(direction);
    const timeline = new EventTimeline(this.eventTimelineSet);
    timeline.startState = forkState.clone(); // Now clobber the end state of the new live timeline with that from the
    // previous live timeline. It will be identical except that we'll keep
    // using the same RoomMember objects for the 'live' set of members with any
    // listeners still attached

    timeline.endState = forkState; // Firstly, we just stole the current timeline's end state, so it needs a new one.
    // Make an immutable copy of the state so back pagination will get the correct sentinels.

    this.endState = forkState.clone();
    return timeline;
  }
  /**
   * Creates an independent timeline, inheriting the directional state from this timeline.
   *
   * @param {string} direction   EventTimeline.BACKWARDS to get the state at the
   *   start of the timeline; EventTimeline.FORWARDS to get the state at the end
   *   of the timeline.
   *
   * @return {EventTimeline} the new timeline
   */


  fork(direction) {
    const forkState = this.getState(direction);
    const timeline = new EventTimeline(this.eventTimelineSet);
    timeline.startState = forkState.clone();
    timeline.endState = forkState.clone();
    return timeline;
  }
  /**
   * Get the ID of the room for this timeline
   * @return {string} room ID
   */


  getRoomId() {
    return this.roomId;
  }
  /**
   * Get the filter for this timeline's timelineSet (if any)
   * @return {Filter} filter
   */


  getFilter() {
    return this.eventTimelineSet.getFilter();
  }
  /**
   * Get the timelineSet for this timeline
   * @return {EventTimelineSet} timelineSet
   */


  getTimelineSet() {
    return this.eventTimelineSet;
  }
  /**
   * Get the base index.
   *
   * <p>This is an index which is incremented when events are prepended to the
   * timeline. An individual event therefore stays at the same index in the array
   * relative to the base index (although note that a given event's index may
   * well be less than the base index, thus giving that event a negative relative
   * index).
   *
   * @return {number}
   */


  getBaseIndex() {
    return this.baseIndex;
  }
  /**
   * Get the list of events in this context
   *
   * @return {MatrixEvent[]} An array of MatrixEvents
   */


  getEvents() {
    return this.events;
  }
  /**
   * Get the room state at the start/end of the timeline
   *
   * @param {string} direction   EventTimeline.BACKWARDS to get the state at the
   *   start of the timeline; EventTimeline.FORWARDS to get the state at the end
   *   of the timeline.
   *
   * @return {RoomState} state at the start/end of the timeline
   */


  getState(direction) {
    if (direction == EventTimeline.BACKWARDS) {
      return this.startState;
    } else if (direction == EventTimeline.FORWARDS) {
      return this.endState;
    } else {
      throw new Error("Invalid direction '" + direction + "'");
    }
  }
  /**
   * Get a pagination token
   *
   * @param {string} direction   EventTimeline.BACKWARDS to get the pagination
   *   token for going backwards in time; EventTimeline.FORWARDS to get the
   *   pagination token for going forwards in time.
   *
   * @return {?string} pagination token
   */


  getPaginationToken(direction) {
    return this.getState(direction).paginationToken;
  }
  /**
   * Set a pagination token
   *
   * @param {?string} token       pagination token
   *
   * @param {string} direction    EventTimeline.BACKWARDS to set the paginatio
   *   token for going backwards in time; EventTimeline.FORWARDS to set the
   *   pagination token for going forwards in time.
   */


  setPaginationToken(token, direction) {
    this.getState(direction).paginationToken = token;
  }
  /**
   * Get the next timeline in the series
   *
   * @param {string} direction EventTimeline.BACKWARDS to get the previous
   *   timeline; EventTimeline.FORWARDS to get the next timeline.
   *
   * @return {?EventTimeline} previous or following timeline, if they have been
   * joined up.
   */


  getNeighbouringTimeline(direction) {
    if (direction == EventTimeline.BACKWARDS) {
      return this.prevTimeline;
    } else if (direction == EventTimeline.FORWARDS) {
      return this.nextTimeline;
    } else {
      throw new Error("Invalid direction '" + direction + "'");
    }
  }
  /**
   * Set the next timeline in the series
   *
   * @param {EventTimeline} neighbour previous/following timeline
   *
   * @param {string} direction EventTimeline.BACKWARDS to set the previous
   *   timeline; EventTimeline.FORWARDS to set the next timeline.
   *
   * @throws {Error} if an attempt is made to set the neighbouring timeline when
   * it is already set.
   */


  setNeighbouringTimeline(neighbour, direction) {
    if (this.getNeighbouringTimeline(direction)) {
      throw new Error("timeline already has a neighbouring timeline - " + "cannot reset neighbour (direction: " + direction + ")");
    }

    if (direction == EventTimeline.BACKWARDS) {
      this.prevTimeline = neighbour;
    } else if (direction == EventTimeline.FORWARDS) {
      this.nextTimeline = neighbour;
    } else {
      throw new Error("Invalid direction '" + direction + "'");
    } // make sure we don't try to paginate this timeline


    this.setPaginationToken(null, direction);
  }
  /**
   * Add a new event to the timeline, and update the state
   *
   * @param {MatrixEvent} event   new event
   * @param {IAddEventOptions} options addEvent options
   */


  addEvent(event, toStartOfTimelineOrOpts, roomState) {
    let toStartOfTimeline = !!toStartOfTimelineOrOpts;
    let timelineWasEmpty;

    if (typeof toStartOfTimelineOrOpts === 'object') {
      ({
        toStartOfTimeline,
        roomState,
        timelineWasEmpty
      } = toStartOfTimelineOrOpts);
    } else if (toStartOfTimelineOrOpts !== undefined) {
      // Deprecation warning
      // FIXME: Remove after 2023-06-01 (technical debt)
      _logger.logger.warn('Overload deprecated: ' + '`EventTimeline.addEvent(event, toStartOfTimeline, roomState?)` ' + 'is deprecated in favor of the overload with `EventTimeline.addEvent(event, IAddEventOptions)`');
    }

    if (!roomState) {
      roomState = toStartOfTimeline ? this.startState : this.endState;
    }

    const timelineSet = this.getTimelineSet();

    if (timelineSet.room) {
      EventTimeline.setEventMetadata(event, roomState, toStartOfTimeline); // modify state but only on unfiltered timelineSets

      if (event.isState() && timelineSet.room.getUnfilteredTimelineSet() === timelineSet) {
        roomState.setStateEvents([event], {
          timelineWasEmpty
        }); // it is possible that the act of setting the state event means we
        // can set more metadata (specifically sender/target props), so try
        // it again if the prop wasn't previously set. It may also mean that
        // the sender/target is updated (if the event set was a room member event)
        // so we want to use the *updated* member (new avatar/name) instead.
        //
        // However, we do NOT want to do this on member events if we're going
        // back in time, else we'll set the .sender value for BEFORE the given
        // member event, whereas we want to set the .sender value for the ACTUAL
        // member event itself.

        if (!event.sender || event.getType() === "m.room.member" && !toStartOfTimeline) {
          EventTimeline.setEventMetadata(event, roomState, toStartOfTimeline);
        }
      }
    }

    let insertIndex;

    if (toStartOfTimeline) {
      insertIndex = 0;
    } else {
      insertIndex = this.events.length;
    }

    this.events.splice(insertIndex, 0, event); // insert element

    if (toStartOfTimeline) {
      this.baseIndex++;
    }
  }
  /**
   * Remove an event from the timeline
   *
   * @param {string} eventId  ID of event to be removed
   * @return {?MatrixEvent} removed event, or null if not found
   */


  removeEvent(eventId) {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const ev = this.events[i];

      if (ev.getId() == eventId) {
        this.events.splice(i, 1);

        if (i < this.baseIndex) {
          this.baseIndex--;
        }

        return ev;
      }
    }

    return null;
  }
  /**
   * Return a string to identify this timeline, for debugging
   *
   * @return {string} name for this timeline
   */


  toString() {
    return this.name;
  }

}

exports.EventTimeline = EventTimeline;

_defineProperty(EventTimeline, "BACKWARDS", Direction.Backward);

_defineProperty(EventTimeline, "FORWARDS", Direction.Forward);