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
