#  This Source Code Form is subject to the terms of the Mozilla Public
#  License, v. 2.0. If a copy of the MPL was not distributed with this
#  file, You can obtain one at http://mozilla.org/MPL/2.0/.

from __future__ import absolute_import, print_function, unicode_literals

import logging

from gecko_taskgraph.target_tasks import (
    _target_task,
    _try_task_config,
    filter_out_shipping_phase,
    standard_filter,
)
from comm_taskgraph.try_option_syntax import _try_cc_option_syntax

logger = logging.getLogger(__name__)


@_target_task("comm_searchfox_index")
def target_tasks_searchfox(full_task_graph, parameters, graph_config):
    """Select tasks required for indexing Thunderbird for Searchfox web site each day"""
    return [
        "searchfox-linux64-searchfox/debug",
        "searchfox-macosx64-searchfox/debug",
        "searchfox-win64-searchfox/debug",
    ]


@_target_task("comm_central_tasks")
def target_tasks_default(full_task_graph, parameters, graph_config):
    """Target the tasks which have indicated they should be run on this project
    via the `run_on_projects` attributes."""
    return [
        l
        for l, t in full_task_graph.tasks.items()
        if standard_filter(t, parameters) and filter_out_shipping_phase(t, parameters)
    ]


@_target_task("try_cc_tasks")
def target_tasks_try(full_task_graph, parameters, graph_config):
    try_mode = parameters["try_mode"]
    if try_mode == "try_task_config":
        return _try_task_config(full_task_graph, parameters, graph_config)
    elif try_mode == "try_option_syntax":
        return _try_cc_option_syntax(full_task_graph, parameters, graph_config)
    else:
        # With no try mode, we schedule nothing, allowing the user to add tasks
        # later via treeherder.
        return []
