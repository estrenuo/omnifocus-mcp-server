// ============================================================================
// Helper Scripts (JXA syntax - properties are accessed as methods)
// ============================================================================

export const TASK_MAPPER = `
function mapTask(t) {
  var noteVal = t.note();
  var noteStr = noteVal ? String(noteVal) : "";

  var dueDate = t.dueDate();
  var deferDate = t.deferDate();
  var plannedDate = null;
  try {
    plannedDate = t.plannedDate ? t.plannedDate() : null;
  } catch(e) {}
  var containingProj = t.containingProject();
  var assignedContainerObj = null;
  try { assignedContainerObj = t.assignedContainer(); } catch(e) {}
  var tagsList = t.tags();

  var repetitionRule = null;
  var repetitionMethod = null;
  try {
    var repRule = t.repetitionRule();
    if (repRule) {
      repetitionRule = String(repRule);
    }
    var repMethod = t.repetitionMethod();
    if (repMethod) {
      repetitionMethod = String(repMethod);
    }
  } catch(e) {}

  // Get parent task information
  var parentTask = null;
  var parentTaskId = null;
  var parentTaskName = null;
  try {
    parentTask = t.parentTask();
    if (parentTask) {
      parentTaskId = parentTask.id();
      parentTaskName = parentTask.name();
    }
  } catch(e) {}

  // Get child task information
  var childTasks = [];
  var childTaskCount = 0;
  try {
    childTasks = t.tasks();
    childTaskCount = childTasks.length;
  } catch(e) {}

  return {
    id: t.id(),
    name: t.name(),
    note: noteStr,
    completed: t.completed(),
    dropped: t.dropped(),
    flagged: t.flagged(),
    dueDate: dueDate ? dueDate.toISOString() : null,
    deferDate: deferDate ? deferDate.toISOString() : null,
    plannedDate: plannedDate ? plannedDate.toISOString() : null,
    estimatedMinutes: t.estimatedMinutes(),
    tags: tagsList.map(function(tag) { return tag.name(); }),
    projectName: containingProj ? containingProj.name() : null,
    assignedProject: assignedContainerObj ? assignedContainerObj.name() : null,
    inInbox: t.inInbox(),
    repetitionRule: repetitionRule,
    repetitionMethod: repetitionMethod,
    parentTaskId: parentTaskId,
    parentTaskName: parentTaskName,
    hasChildren: childTaskCount > 0,
    childTaskCount: childTaskCount
  };
}
`;

export const PROJECT_MAPPER = `
function mapProject(p) {
  var noteVal = p.note();
  var noteStr = noteVal ? String(noteVal) : "";

  var statusVal = p.status();
  var statusStr = statusVal ? String(statusVal) : "Unknown";

  var dueDate = p.dueDate();
  var deferDate = p.deferDate();
  var folder = p.folder();
  var nextReviewDate = null;
  try {
    nextReviewDate = p.nextReviewDate ? p.nextReviewDate() : null;
  } catch(e) {}

  return {
    id: p.id(),
    name: p.name(),
    note: noteStr,
    status: statusStr,
    completed: p.completed(),
    flagged: p.flagged(),
    dueDate: dueDate ? dueDate.toISOString() : null,
    deferDate: deferDate ? deferDate.toISOString() : null,
    folderName: folder ? folder.name() : null,
    taskCount: p.flattenedTasks().length,
    sequential: p.sequential(),
    nextReviewDate: nextReviewDate ? nextReviewDate.toISOString() : null
  };
}
`;

export const FOLDER_MAPPER = `
function mapFolder(f) {
  var parentName = null;
  try {
    var pf = f.folder();
    if (pf && typeof pf.name === "function") {
      parentName = pf.name();
    }
  } catch(e) {}

  return {
    id: f.id(),
    name: f.name(),
    status: f.hidden() ? "dropped" : "active",
    projectCount: f.projects().length,
    folderCount: f.folders().length,
    parentName: parentName
  };
}
`;

export const TAG_MAPPER = `
function mapTag(t) {
  return {
    id: t.id(),
    name: t.name(),
    status: t.hidden() ? "dropped" : "active",
    taskCount: t.tasks().length,
    allowsNextAction: t.allowsNextAction(),
    parentName: null
  };
}
`;

export const PERSPECTIVE_MAPPER = `
function mapPerspectives(limit) {
  var names = app.perspectives.name();
  var ids = app.perspectives.id();
  var results = [];
  for (var i = 0; i < names.length && results.length < limit; i++) {
    if (names[i] != null) {
      results.push({ id: ids[i] || null, name: names[i] });
    }
  }
  return results;
}
`;
