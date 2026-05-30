#!/usr/bin/env python3
"""
Batch convert manual loading state pattern to useTransition in CRUD list pages.

Pattern:
  const [loading, setLoading] = useState(false);
  ...
  const fetchXxx = useCallback(async (...) => {
    setLoading(true);
    try { ... } finally { setLoading(false); }
  }, [deps]);
  ...
  <ConfigurableTable loading={loading} .../>

→

  const [isPending, startTransition] = useTransition();
  ...
  const fetchXxx = useCallback((...) => {
    startTransition(async () => { ... });
  }, [deps]);
  ...
  <ConfigurableTable pending={isPending} .../>
"""

import os
import re
import sys
from pathlib import Path

TARGET_PAGES = [
    "packages/web/src/pages/system/roles/RolesPage.tsx",
    "packages/web/src/pages/system/positions/PositionsPage.tsx",
    "packages/web/src/pages/system/departments/DepartmentsPage.tsx",
    "packages/web/src/pages/system/menus/MenusPage.tsx",
    "packages/web/src/pages/system/dicts/DictsPage.tsx",
    "packages/web/src/pages/system/configs/SystemConfigsPage.tsx",
    "packages/web/src/pages/system/cron-jobs/CronJobsPage.tsx",
    "packages/web/src/pages/system/tenants/TenantsPage.tsx",
    "packages/web/src/pages/system/user-groups/UserGroupsPage.tsx",
    "packages/web/src/pages/system/tags/TagsPage.tsx",
    "packages/web/src/pages/system/sessions/OnlineSessionsPage.tsx",
    "packages/web/src/pages/system/login-logs/LoginLogsPage.tsx",
    "packages/web/src/pages/system/operation-logs/OperationLogsPage.tsx",
    "packages/web/src/pages/system/data-mask/DataMaskPage.tsx",
    "packages/web/src/pages/system/db-backups/DbBackupsPage.tsx",
    "packages/web/src/pages/system/email-send-logs/EmailSendLogsPage.tsx",
    "packages/web/src/pages/system/email-templates/EmailTemplatesPage.tsx",
    "packages/web/src/pages/system/file-configs/FileStorageConfigsPage.tsx",
    "packages/web/src/pages/system/files/FilesPage.tsx",
    "packages/web/src/pages/system/in-app-messages/InAppMessagesPage.tsx",
    "packages/web/src/pages/system/in-app-templates/InAppTemplatesPage.tsx",
    "packages/web/src/pages/system/sms-configs/SmsConfigsPage.tsx",
    "packages/web/src/pages/system/sms-send-logs/SmsSendLogsPage.tsx",
    "packages/web/src/pages/system/sms-templates/SmsTemplatesPage.tsx",
    "packages/web/src/pages/system/rate-limit/RateLimitPage.tsx",
    "packages/web/src/pages/system/regions/RegionsPage.tsx",
    "packages/web/src/pages/system/oauth2-apps/OAuth2AppsPage.tsx",
    "packages/web/src/pages/system/ip-access/IpAccessPage.tsx",
    "packages/web/src/pages/announcements/AnnouncementsPage.tsx",
    "packages/web/src/pages/inbox/InboxPage.tsx",
    "packages/web/src/pages/ai/providers/AIProvidersPage.tsx",
    "packages/web/src/pages/workflow/automations/WorkflowAutomationsPage.tsx",
    "packages/web/src/pages/workflow/definitions/WorkflowDefinitionsPage.tsx",
    "packages/web/src/pages/workflow/event-subscriptions/WorkflowEventSubscriptionsPage.tsx",
    "packages/web/src/pages/workflow/instances/MyApplicationsPage.tsx",
    "packages/web/src/pages/workflow/monitor/WorkflowMonitorPage.tsx",
    "packages/web/src/pages/workflow/tasks/PendingApprovalsPage.tsx",
    "packages/web/src/pages/workflow/trigger-executions/WorkflowTriggerExecutionsPage.tsx",
]


def add_use_transition_import(content: str) -> str:
    """Add useTransition to React imports if not already present."""
    if 'useTransition' in content:
        return content

    # Match various React import patterns
    # Pattern 1: import { ..., useState, ... } from 'react'
    m = re.search(r"(import\s+\{[^}]+)\}\s+from\s+'react'", content)
    if m:
        old_import_block = m.group(1)
        new_import_block = old_import_block.rstrip() + ', useTransition'
        return content.replace(
            m.group(0), new_import_block + "} from 'react'", 1
        )

    # Pattern 2: import React, { ... } from 'react'
    m = re.search(
        r"(import\s+React\s*,\s*\{[^}]+)\}\s+from\s+'react'", content
    )
    if m:
        old_import_block = m.group(1)
        new_import_block = old_import_block.rstrip() + ', useTransition'
        return content.replace(
            m.group(0), new_import_block + "} from 'react'", 1
        )

    return content


def remove_loading_state(content: str) -> str:
    """Replace const [loading, setLoading] = useState(false) with useTransition."""
    return content.replace(
        'const [loading, setLoading] = useState(false);',
        'const [isPending, startTransition] = useTransition();',
    )


def transform_fetch_function_try_finally(content: str) -> str:
    """
    Transform the fetch function pattern:
      setLoading(true);
      try {
        ...body...
      } finally {
        setLoading(false);
      }
    →
      startTransition(async () => {
        ...body...
      });
    """
    # Step 1: Replace `<indent>setLoading(true);\n<indent>try {`
    # with `<indent>startTransition(async () => {`
    # The setLoading(true) and try { must be at the same indentation level
    content = re.sub(
        r'([ \t]+)setLoading\(true\);\n\1try \{',
        r'\1startTransition(async () => {',
        content,
    )

    # Step 2: Replace `<indent>} finally {\n<indent2>setLoading(false);\n<indent>}`
    # with `<indent>});`
    content = re.sub(
        r'([ \t]+)\} finally \{\n[ \t]+setLoading\(false\);\n\1\}',
        r'\1});',
        content,
    )

    return content


def remove_async_from_callback(content: str) -> str:
    """
    Remove `async` from useCallback where it now wraps startTransition.
    Targets: useCallback(async (...) => {\n...\startTransition(async
    """
    # After transformation, the pattern is:
    # useCallback(async (...) => {
    #   startTransition(async () => {
    # We change useCallback(async ( to useCallback((
    # But only when startTransition appears shortly after

    def replace_if_has_start_transition(m):
        # Check if startTransition appears within the next ~10 lines after this match
        pos = m.end()
        next_chunk = content[pos : pos + 500]
        if 'startTransition(async () => {' in next_chunk:
            return m.group(0).replace('async (', '(', 1)
        return m.group(0)

    # Match useCallback(async (
    # Can't use replace_if_has_start_transition with re.sub on original content
    # because content was already modified; re-process
    result = re.sub(
        r'useCallback\(async \(',
        lambda m: m.group(0),  # placeholder, handle below
        content,
    )

    # Simpler: just replace all useCallback(async ( where we've already done startTransition
    # Since we already transformed the try/finally, any useCallback(async ( that had
    # setLoading(true) now has startTransition. So replace all useCallback(async (
    # that appear just before a startTransition in the same function.

    # Use a character-by-character approach to find useCallback(async ( and check ahead
    lines = content.split('\n')
    result_lines = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if 'useCallback(async (' in line:
            # Look ahead up to 5 lines for startTransition
            look_ahead = '\n'.join(lines[i : min(i + 5, len(lines))])
            if 'startTransition(async () => {' in look_ahead:
                line = line.replace('useCallback(async (', 'useCallback((', 1)
        result_lines.append(line)
        i += 1
    return '\n'.join(result_lines)


def replace_loading_prop_on_table(content: str) -> str:
    """Replace loading={loading} with pending={isPending} on ConfigurableTable."""
    return re.sub(r'\bloading=\{loading\}', 'pending={isPending}', content)


def transform_file(filepath: str, root: str = '.') -> tuple[bool, str]:
    """
    Transform a single file. Returns (success, message).
    """
    full_path = os.path.join(root, filepath)

    if not os.path.exists(full_path):
        return False, f"File not found: {full_path}"

    with open(full_path, 'r', encoding='utf-8') as f:
        original = f.read()

    # Check if file has the loading state pattern
    if 'const [loading, setLoading] = useState(false)' not in original:
        return False, f"SKIP (no loading state): {filepath}"

    # Check if already converted
    if 'const [isPending, startTransition] = useTransition()' in original:
        return False, f"SKIP (already converted): {filepath}"

    content = original

    # Apply transformations
    content = add_use_transition_import(content)
    content = remove_loading_state(content)
    content = transform_fetch_function_try_finally(content)
    content = remove_async_from_callback(content)
    content = replace_loading_prop_on_table(content)

    # Verify transformations were applied
    if 'setLoading(true)' in content:
        return (
            False,
            f"WARNING: setLoading(true) still present after transform: {filepath}",
        )

    if 'setLoading(false)' in content:
        return (
            False,
            f"WARNING: setLoading(false) still present after transform: {filepath}",
        )

    if content == original:
        return False, f"SKIP (no changes made): {filepath}"

    with open(full_path, 'w', encoding='utf-8') as f:
        f.write(content)

    return True, f"OK: {filepath}"


def main():
    # Get root directory (should be zenith-admin workspace root)
    root = os.getcwd()
    print(f"Working directory: {root}\n")

    success_count = 0
    skip_count = 0
    warn_count = 0

    for page in TARGET_PAGES:
        ok, msg = transform_file(page, root)
        if ok:
            print(f"  ✓ {msg}")
            success_count += 1
        elif msg.startswith("WARNING"):
            print(f"  ⚠ {msg}")
            warn_count += 1
        else:
            print(f"  · {msg}")
            skip_count += 1

    print(
        f"\nDone: {success_count} converted, {skip_count} skipped, {warn_count} warnings"
    )
    if warn_count > 0:
        print("⚠ Pages with warnings need manual inspection!")
        sys.exit(1)


if __name__ == '__main__':
    main()
