/**
 * Folder tools: list, create, rename, delete.
 */

import { server } from "../server.js";
import { executeAndParseJSON } from "../executor.js";
import type { FolderData } from "../types.js";
import { sanitizeInput } from "../sanitization.js";
import { FOLDER_MAPPER } from "../mappers.js";
import { generateFindFolderScript } from "../helpers.js";
import {
  ListFoldersInputSchema,
  CreateFolderInputSchema,
  UpdateFolderInputSchema,
  DeleteFolderInputSchema
} from "../schemas.js";

// ============================================================================
// Tool: List Folders
// ============================================================================

server.registerTool(
  "omnifocus_list_folders",
  {
    title: "List Folders",
    description: `List folders in OmniFocus.

Folders are used to organize projects hierarchically.

Args:
  - status (string): Filter by status - 'all', 'active', 'dropped' (default: 'active')
  - limit (number): Maximum folders to return, 1-200 (default: 50)

Returns:
  Array of folder objects with: id, name, status, projectCount, folderCount, parentName

Examples:
  - List active folders: {}
  - List all folders: { status: "all" }`,
    inputSchema: ListFoldersInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { status, limit } = params;
    
    let statusFilter = "";
    if (status === "active") {
      statusFilter = `.filter(function(f) { return !f.hidden(); })`;
    } else if (status === "dropped") {
      statusFilter = `.filter(function(f) { return f.hidden(); })`;
    }

    const script = `
      ${FOLDER_MAPPER}
      var folders = doc.flattenedFolders()${statusFilter}.slice(0, ${limit});
      JSON.stringify(folders.map(mapFolder));
    `;
    
    try {
      const folders = await executeAndParseJSON<FolderData[]>(script);
      
      if (folders.length === 0) {
        return {
          content: [{ type: "text", text: "No folders found." }]
        };
      }
      
      const output = {
        count: folders.length,
        folders: folders
      };
      
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error listing folders: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Create Folder
// ============================================================================

server.registerTool(
  "omnifocus_create_folder",
  {
    title: "Create Folder",
    description: `Create a new folder in OmniFocus.

Creates a folder at the top level or nested inside an existing folder.

Args:
  - name (string): Folder name (required)
  - parentFolderName (string, optional): Parent folder to nest inside (top level if omitted)

Returns:
  The created folder object with id, name, and other properties

Examples:
  - Top-level folder: { name: "Work" }
  - Nested folder: { name: "Q1", parentFolderName: "Work" }`,
    inputSchema: CreateFolderInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params) => {
    const { name, parentFolderName } = params;

    const safeName = sanitizeInput(name, 500);
    const safeParentName = parentFolderName ? sanitizeInput(parentFolderName, 500) : null;

    const createScript = safeParentName
      ? `
        var parentFolder = doc.flattenedFolders().find(function(f) { return f.name() === "${safeParentName}"; });
        if (!parentFolder) { throw new Error("Parent folder not found: ${safeParentName}"); }
        var folder = app.Folder({name: "${safeName}"});
        parentFolder.folders.push(folder);
      `
      : `
        var folder = app.Folder({name: "${safeName}"});
        doc.folders.push(folder);
      `;

    const script = `
      ${FOLDER_MAPPER}
      ${createScript}
      JSON.stringify(mapFolder(folder));
    `;

    try {
      const folder = await executeAndParseJSON<FolderData>(script);
      return {
        content: [{
          type: "text",
          text: `Folder created successfully:\n${JSON.stringify(folder, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error creating folder: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Update Folder
// ============================================================================

server.registerTool(
  "omnifocus_update_folder",
  {
    title: "Update Folder",
    description: `Rename an existing folder in OmniFocus.

Args:
  - folderId (string, optional): The folder's ID. Takes priority if both folderId and folderName provided.
  - folderName (string, optional): The folder's name to search for. At least one of folderId or folderName is required.
  - name (string): New folder name

Note: moving a folder into another folder is not supported by OmniFocus's JXA layer (the move operation is rejected). Recreate the folder in the target location if you need to move it.

Returns:
  The updated folder object

Examples:
  - Rename by ID: { folderId: "abc123", name: "Archive" }
  - Rename by name: { folderName: "Q1", name: "Q1 2027" }`,
    inputSchema: UpdateFolderInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params) => {
    const { folderId, folderName, name } = params;

    const safeFolderId = folderId ? sanitizeInput(folderId, 100) : null;
    const safeFolderName = folderName ? sanitizeInput(folderName, 500) : null;

    if (!safeFolderId && !safeFolderName) {
      return {
        isError: true,
        content: [{ type: "text", text: "Either folderId or folderName must be provided" }]
      };
    }

    const findFolderScript = generateFindFolderScript(safeFolderId, safeFolderName);

    const script = `
      ${FOLDER_MAPPER}
      ${findFolderScript}
      folder.name = "${sanitizeInput(name, 500)}";
      JSON.stringify(mapFolder(folder));
    `;

    try {
      const folder = await executeAndParseJSON<FolderData>(script);
      return {
        content: [{
          type: "text",
          text: `Folder updated:\n${JSON.stringify(folder, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error updating folder: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Delete Folder
// ============================================================================

server.registerTool(
  "omnifocus_delete_folder",
  {
    title: "Delete Folder",
    description: `Permanently delete a folder from OmniFocus, including any projects and folders it contains. This cannot be undone via MCP.

Use either the folder ID from list/search results, or the folder name.

Args:
  - folderId (string, optional): The folder's ID. Takes priority if both folderId and folderName provided.
  - folderName (string, optional): The folder's name to search for. At least one of folderId or folderName is required.

Returns:
  Confirmation message with the deleted folder's name

Examples:
  - Delete by ID: { folderId: "abc123" }
  - Delete by name: { folderName: "Old folder" }`,
    inputSchema: DeleteFolderInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params) => {
    const { folderId, folderName } = params;

    const safeFolderId = folderId ? sanitizeInput(folderId, 100) : null;
    const safeFolderName = folderName ? sanitizeInput(folderName, 500) : null;

    if (!safeFolderId && !safeFolderName) {
      return {
        isError: true,
        content: [{ type: "text", text: "Either folderId or folderName must be provided" }]
      };
    }

    const findFolderScript = generateFindFolderScript(safeFolderId, safeFolderName);

    const script = `
      ${findFolderScript}
      var deletedName = folder.name();
      app.delete(folder);
      JSON.stringify({ deleted: true, name: deletedName });
    `;

    try {
      const result = await executeAndParseJSON<{ deleted: boolean; name: string }>(script);
      return {
        content: [{
          type: "text",
          text: `Folder deleted: "${result.name}"`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error deleting folder: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);
