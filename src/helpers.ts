// ============================================================================
// Shared Constants
// ============================================================================

export const STATUS_MAP: Record<string, string> = {
  "active": "active status",
  "done": "done status",
  "dropped": "dropped status",
  "onHold": "on hold status"
};

// ============================================================================
// Shared JXA Script Helpers
// ============================================================================

/**
 * Generates JXA script to find a task by ID or name.
 * Used by omnifocus_complete_task, omnifocus_add_tag_to_task, omnifocus_remove_tag_from_task.
 */
export function generateFindTaskScript(safeTaskId: string | null, safeTaskName: string | null): string {
  if (safeTaskId) {
    return `
      var task = doc.flattenedTasks().find(function(t) { return t.id() === "${safeTaskId}"; });
      if (!task) { throw new Error("Task not found with ID: ${safeTaskId}"); }
    `;
  }
  return `
    var allTasks = doc.flattenedTasks();
    var task = allTasks.find(function(t) { return t.name() === "${safeTaskName}"; });
    if (!task) {
      var searchLower = "${safeTaskName!.toLowerCase()}";
      var matches = allTasks.filter(function(t) {
        return t.name().toLowerCase().indexOf(searchLower) !== -1;
      });
      if (matches.length === 0) {
        throw new Error("No task found matching name: ${safeTaskName}");
      } else if (matches.length > 1) {
        var matchList = matches.map(function(t) {
          var proj = t.containingProject();
          return "- " + t.name() + " (ID: " + t.id() + (proj ? ", Project: " + proj.name() : "") + ")";
        }).join("\\n");
        throw new Error("Multiple tasks found matching '${safeTaskName}'. Please use taskId or be more specific:\\n" + matchList);
      }
      task = matches[0];
    }
  `;
}

/**
 * Generates a JXA statement that clears a task's repetition rule through the
 * Omni Automation bridge. Direct JXA cannot unset the rule (assigning it throws
 * -1700), and without clearing it OmniFocus rolls a recurring task forward to
 * its next instance when completed or dropped. `taskVar` is the name of an
 * in-scope JXA task variable. No-op when the task has no repetition rule.
 */
export function generateClearRepetitionScript(taskVar: string): string {
  return `
      (function() {
        var __clearRecurId = ${taskVar}.id();
        app.evaluateJavascript("(function(){var _t=Task.byIdentifier(" + JSON.stringify(__clearRecurId) + ");if(_t.repetitionRule){_t.repetitionRule=null;}})()");
      })();`;
}

/** Recurrence input shared by create_task and update_task (matches the Zod schema). */
export interface RecurrenceInput {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;
  daysOfWeek?: string[];
  dayOfMonth?: number;
  monthOfYear?: number;
  repeatFrom?: "due-date" | "completion-date";
}

/**
 * Translates a validated recurrence object into an iCalendar (RFC 5545) RRULE
 * string and an Omni Automation RepetitionMethod name ("Fixed" for "due-date",
 * "DueDate" for "completion-date"). All inputs are schema-validated enums and
 * integers, so the result is safe to embed in a bridge script.
 */
export function buildRRule(recurrence: RecurrenceInput): { ruleString: string; method: string } {
  const { frequency, interval = 1, daysOfWeek, dayOfMonth, monthOfYear, repeatFrom = "due-date" } = recurrence;

  const ruleParts = [`FREQ=${frequency.toUpperCase()}`, `INTERVAL=${interval}`];
  if (frequency === "weekly" && daysOfWeek && daysOfWeek.length > 0) {
    const dayCodes: Record<string, string> = {
      Sunday: "SU", Monday: "MO", Tuesday: "TU", Wednesday: "WE",
      Thursday: "TH", Friday: "FR", Saturday: "SA"
    };
    ruleParts.push(`BYDAY=${daysOfWeek.map(d => dayCodes[d]).join(",")}`);
  } else if (frequency === "monthly" && dayOfMonth) {
    ruleParts.push(`BYMONTHDAY=${dayOfMonth}`);
  } else if (frequency === "yearly") {
    if (monthOfYear) ruleParts.push(`BYMONTH=${monthOfYear}`);
    if (dayOfMonth) ruleParts.push(`BYMONTHDAY=${dayOfMonth}`);
  }

  const method = repeatFrom === "completion-date" ? "DueDate" : "Fixed";
  return { ruleString: ruleParts.join(";"), method };
}

/**
 * Generates a JXA statement that sets a task's repetition rule through the Omni
 * Automation bridge (direct JXA cannot assign it, -1700). `taskVar` is the name
 * of an in-scope JXA task variable; `ruleString`/`method` come from buildRRule.
 */
export function generateSetRepetitionScript(taskVar: string, ruleString: string, method: string): string {
  return `
      (function() {
        var __setRecurId = ${taskVar}.id();
        var __setRecurRule = ${JSON.stringify(ruleString)};
        var __setRecurOJ = "(function(){var _t=Task.byIdentifier(" + JSON.stringify(__setRecurId) + ");_t.repetitionRule=new Task.RepetitionRule(" + JSON.stringify(__setRecurRule) + ", Task.RepetitionMethod.${method});})()";
        app.evaluateJavascript(__setRecurOJ);
      })();`;
}

/**
 * Generates JXA script to find a project by ID or exact name.
 * Used by omnifocus_update_project and omnifocus_delete_project.
 */
export function generateFindProjectScript(safeProjectId: string | null, safeProjectName: string | null): string {
  if (safeProjectId) {
    return `
      var project = doc.flattenedProjects().find(function(p) { return p.id() === "${safeProjectId}"; });
      if (!project) { throw new Error("Project not found with ID: ${safeProjectId}"); }
    `;
  }
  return `
    var project = doc.flattenedProjects().find(function(p) { return p.name() === "${safeProjectName}"; });
    if (!project) { throw new Error("Project not found: ${safeProjectName}"); }
  `;
}

/**
 * Generates a JXA statement that sets a project's status on an in-scope
 * `project` variable. OmniFocus rejects direct assignment of done/dropped
 * ("Use the mark completed/dropped verb instead"), so those go through
 * markComplete()/markDropped(); active and on hold assign directly (assigning
 * active also reactivates a completed or dropped project).
 * `status` is one of "active" | "on hold" | "done" | "dropped".
 */
export function generateSetProjectStatusScript(status: string): string {
  if (status === "done") return `project.markComplete();`;
  if (status === "dropped") return `project.markDropped();`;
  const jxaStatus = status === "on hold" ? "on hold status" : "active status";
  return `project.status = "${jxaStatus}";`;
}

/**
 * Generates JXA script to find a folder by ID or exact name.
 * Used by omnifocus_update_folder and omnifocus_delete_folder.
 */
export function generateFindFolderScript(safeFolderId: string | null, safeFolderName: string | null): string {
  if (safeFolderId) {
    return `
      var folder = doc.flattenedFolders().find(function(f) { return f.id() === "${safeFolderId}"; });
      if (!folder) { throw new Error("Folder not found with ID: ${safeFolderId}"); }
    `;
  }
  return `
    var folder = doc.flattenedFolders().find(function(f) { return f.name() === "${safeFolderName}"; });
    if (!folder) { throw new Error("Folder not found: ${safeFolderName}"); }
  `;
}

/**
 * Generates a JXA statement that filters an existing `tasks` array by tag names.
 * mode: "all" (has every tag), "any" (has at least one), "none" (has none).
 * Returns an empty string when no tags are supplied.
 */
export function generateTagFilter(safeTags: string[], mode: "all" | "any" | "none"): string {
  if (!safeTags || safeTags.length === 0) return "";
  const tagsJson = JSON.stringify(safeTags);
  const condition =
    mode === "any" ? "matched.length > 0" :
    mode === "none" ? "matched.length === 0" :
    "matched.length === wanted.length";
  return `
      var wanted = ${tagsJson};
      tasks = tasks.filter(function(t) {
        var names = t.tags().map(function(tg) { return tg.name(); });
        var matched = wanted.filter(function(w) { return names.indexOf(w) !== -1; });
        return ${condition};
      });`;
}
