/**
 * Review tools: projects due for review, mark reviewed, batch mark reviewed.
 */

import { server } from "../server.js";
import { executeAndParseJSON } from "../executor.js";
import type { ProjectData } from "../types.js";
import { sanitizeInput, sanitizeArray } from "../sanitization.js";
import { PROJECT_MAPPER } from "../mappers.js";
import { STATUS_MAP } from "../helpers.js";
import {
  GetProjectsForReviewInputSchema,
  MarkProjectReviewedInputSchema,
  BatchMarkReviewedInputSchema
} from "../schemas.js";

// ============================================================================
// Tool: Get Projects for Review
// ============================================================================

server.registerTool(
  "omnifocus_get_projects_for_review",
  {
    title: "Get Projects for Review",
    description: `Get projects that need review based on their next review date.

Returns projects whose next review date is on or before today (or within specified days ahead).

Args:
  - daysAhead (number): Days to look ahead, 0-365 (default: 0 = overdue only)
  - status (string): Filter by status - 'all', 'active', 'done', 'dropped', 'onHold' (default: 'active')
  - limit (number): Maximum projects to return, 1-500 (default: 50)

Returns:
  Array of projects needing review sorted by next review date

Examples:
  - Overdue reviews: {}
  - Reviews due within 7 days: { daysAhead: 7 }
  - All active projects due for review: { status: "active", daysAhead: 30 }`,
    inputSchema: GetProjectsForReviewInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { daysAhead, status, limit } = params;

    let statusFilter = "";
    if (status !== "all") {
      statusFilter = `.filter(function(p) { return String(p.status()) === "${STATUS_MAP[status]}"; })`;
    }

    const script = `
      ${PROJECT_MAPPER}
      var now = new Date();
      var futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + ${daysAhead});
      futureDate.setHours(23, 59, 59, 999);

      var projects = doc.flattenedProjects()${statusFilter}.filter(function(p) {
        var nextReview = null;
        try {
          nextReview = p.nextReviewDate ? p.nextReviewDate() : null;
        } catch(e) {}
        if (!nextReview) return false;
        return nextReview <= futureDate;
      }).sort(function(a, b) {
        var aReview = null;
        var bReview = null;
        try {
          aReview = a.nextReviewDate ? a.nextReviewDate() : null;
          bReview = b.nextReviewDate ? b.nextReviewDate() : null;
        } catch(e) {}
        if (!aReview || !bReview) return 0;
        return aReview - bReview;
      }).slice(0, ${limit});

      JSON.stringify(projects.map(mapProject));
    `;

    try {
      const projects = await executeAndParseJSON<ProjectData[]>(script);

      if (projects.length === 0) {
        return {
          content: [{ type: "text", text: "No projects need review." }]
        };
      }

      const output = {
        count: projects.length,
        daysAhead,
        projects
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error getting projects for review: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Mark Project Reviewed
// ============================================================================

server.registerTool(
  "omnifocus_mark_project_reviewed",
  {
    title: "Mark Project Reviewed",
    description: `Mark a project as reviewed and update its next review date.

Use either the project ID or project name to identify the project. The next review date will be set based on the project's review interval or a custom interval if provided.

Args:
  - projectId (string, optional): The project's ID. Takes priority if both projectId and projectName provided.
  - projectName (string, optional): The project's name to search for. At least one of projectId or projectName is required.
  - reviewIntervalDays (number, optional): Custom review interval in days (1-3650). If not provided, uses the project's current review interval.

Returns:
  The updated project object

Examples:
  - By ID: { projectId: "abc123" }
  - By name: { projectName: "Work Project" }
  - With custom interval: { projectName: "Weekly Project", reviewIntervalDays: 7 }`,
    inputSchema: MarkProjectReviewedInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params) => {
    const { projectId, projectName, reviewIntervalDays } = params;

    // Sanitize user inputs
    const safeProjectId = projectId ? sanitizeInput(projectId, 100) : null;
    const safeProjectName = projectName ? sanitizeInput(projectName, 500) : null;

    let findProjectScript: string;
    if (safeProjectId) {
      findProjectScript = `
        var project = doc.flattenedProjects().find(function(p) { return p.id() === "${safeProjectId}"; });
        if (!project) { throw new Error("Project not found with ID: ${safeProjectId}"); }
      `;
    } else if (safeProjectName) {
      findProjectScript = `
        var allProjects = doc.flattenedProjects();

        // Try exact match first
        var project = allProjects.find(function(p) { return p.name() === "${safeProjectName}"; });

        // If no exact match, try case-insensitive partial match
        if (!project) {
          var searchLower = "${safeProjectName.toLowerCase()}";
          var matches = allProjects.filter(function(p) {
            return p.name().toLowerCase().indexOf(searchLower) !== -1;
          });

          if (matches.length === 0) {
            throw new Error("No project found matching name: ${safeProjectName}");
          } else if (matches.length > 1) {
            var matchList = matches.map(function(p) {
              var folder = p.folder();
              return "- " + p.name() + " (ID: " + p.id() + (folder ? ", Folder: " + folder.name() : "") + ")";
            }).join("\\n");
            throw new Error("Multiple projects found matching '${safeProjectName}'. Please use projectId or be more specific:\\n" + matchList);
          }
          project = matches[0];
        }
      `;
    } else {
      return {
        isError: true,
        content: [{ type: "text", text: "Either projectId or projectName must be provided" }]
      };
    }

    // Mark as reviewed - this sets the next review date based on the project's review interval
    let reviewScript: string;
    if (reviewIntervalDays) {
      // Set custom review interval
      reviewScript = `
        project.reviewInterval = {unit: "day", steps: ${reviewIntervalDays}}; // record form; raw seconds segfaults osascript
        project.markReviewed();
      `;
    } else {
      // Use existing review interval
      reviewScript = `project.markReviewed();`;
    }

    const script = `
      ${PROJECT_MAPPER}
      ${findProjectScript}
      ${reviewScript}
      JSON.stringify(mapProject(project));
    `;

    try {
      const project = await executeAndParseJSON<ProjectData>(script);

      return {
        content: [{
          type: "text",
          text: `Project marked as reviewed:\n${JSON.stringify(project, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error marking project as reviewed: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Batch Mark Projects Reviewed
// ============================================================================

server.registerTool(
  "omnifocus_batch_mark_reviewed",
  {
    title: "Batch Mark Projects Reviewed",
    description: `Mark multiple projects as reviewed in one operation.

Efficiently updates the review status for multiple projects at once.

Args:
  - projectIds (array): Array of project IDs to mark as reviewed (1-100 projects)
  - reviewIntervalDays (number, optional): Custom review interval in days (1-3650) to apply to all projects

Returns:
  Summary with count of successfully reviewed projects and any errors

Examples:
  - Review multiple projects: { projectIds: ["id1", "id2", "id3"] }
  - With custom interval: { projectIds: ["id1", "id2"], reviewIntervalDays: 14 }`,
    inputSchema: BatchMarkReviewedInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params) => {
    const { projectIds, reviewIntervalDays } = params;

    // Sanitize project IDs array
    const safeProjectIds = sanitizeArray(projectIds, 100, 100);
    const projectIdsJson = JSON.stringify(safeProjectIds);

    let reviewScript: string;
    if (reviewIntervalDays) {
      reviewScript = `
        project.reviewInterval = {unit: "day", steps: ${reviewIntervalDays}}; // record form; raw seconds segfaults osascript
        project.markReviewed();
      `;
    } else {
      reviewScript = `project.markReviewed();`;
    }

    const script = `
      ${PROJECT_MAPPER}
      var targetIds = ${projectIdsJson};
      var allProjects = doc.flattenedProjects();
      var results = {
        successful: [],
        failed: []
      };

      targetIds.forEach(function(projectId) {
        try {
          // Find project by ID (already sanitized on input)
          var project = allProjects.find(function(p) { return p.id() === projectId; });
          if (!project) {
            results.failed.push({
              projectId: projectId,
              error: "Project not found"
            });
            return;
          }

          ${reviewScript}

          results.successful.push(mapProject(project));
        } catch (e) {
          results.failed.push({
            projectId: projectId,
            error: String(e)
          });
        }
      });

      JSON.stringify(results);
    `;

    try {
      const results = await executeAndParseJSON<{
        successful: ProjectData[];
        failed: Array<{ projectId: string; error: string }>;
      }>(script);

      const output = {
        totalRequested: projectIds.length,
        successCount: results.successful.length,
        failureCount: results.failed.length,
        reviewedProjects: results.successful,
        failures: results.failed
      };

      if (results.failed.length > 0) {
        return {
          isError: false,
          content: [{
            type: "text",
            text: `Batch review completed with some errors:\n${JSON.stringify(output, null, 2)}`
          }]
        };
      }

      return {
        content: [{
          type: "text",
          text: `Successfully marked ${results.successful.length} project(s) as reviewed:\n${JSON.stringify(output, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error in batch mark reviewed: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);
