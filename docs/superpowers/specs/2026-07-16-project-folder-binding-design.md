# Project And Folder Binding Design

Date: 2026-07-16
Status: Approved by user

## 1. Decision

The product hierarchy is:

```text
Project (internal Workspace)
  optional local folder binding: zero or one
  Tasks: zero or more
    Thread / Run / Artifacts
```

A Project is not a folder. A folder is an optional local execution boundary attached to a Project.

## 2. Product Behavior

1. A user can create a Project by entering only a name.
2. The Project appears in the left navigation immediately with an unbound-folder state.
3. The user can create Tasks before or after binding a folder.
4. The user can bind one folder through the native Windows directory picker.
5. One folder path cannot be bound to more than one Project.
6. Selecting a folder does not copy files or create a Task.
7. Existing Workspaces remain valid Projects with their current folder binding.

## 3. UI Contract

1. Primary navigation label: `项目`.
2. Section label: `我的项目`.
3. Empty title: `还没有项目`.
4. Primary empty action: `新建项目`.
5. Project creation uses an in-product form with visible validation, busy and error states.
6. Unbound Projects expose one icon action named `绑定文件夹`.
7. Bound Projects show a folder indicator and expose the full canonical path as a tooltip.
8. Task creation remains a separate action inside a Project.

## 4. Data And Protocol Contract

1. `Workspace.folderPath` becomes nullable at persistence and optional at product boundaries.
2. `workspace.create` accepts `name` and an optional folder path for backward compatibility.
3. `workspace.bindFolder` accepts `workspaceId` and an absolute folder path.
4. Binding is idempotent for the same Project and same canonical path.
5. Binding fails when the Project already has a different folder or the path belongs to another Project.
6. Path canonicalization and allowlist validation remain server-side.

## 5. Acceptance Criteria

1. Fresh database: create a Project without choosing a folder and see it after reload.
2. Create a Task under an unbound Project and open its conversation.
3. Bind a folder and see the folder state update without restarting.
4. Cancel the picker and preserve the unbound Project without an error.
5. Reject duplicate-path binding and show a visible error.
6. Reopen an existing database and preserve all current Workspace paths and Tasks.
7. Deep and light themes show no clipped labels, overlaps or hidden errors at 1280x720 and 1440x900.
