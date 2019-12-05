import * as vscode from 'vscode';
import * as path from 'path';

import {
	EventEmitter,
	IIdMaker,
	OFileChangeTracker,
	FileChangeTracker
} from '../types';

export default class VSCodeFileSystemWatcher extends FileChangeTracker {

	protected watcherService: Map<vscode.GlobPattern, vscode.FileSystemWatcher> = new Map();

	constructor(
		idMaker: IIdMaker,
		eventEmitter: EventEmitter,
		public cfg: OFileChangeTracker,
		public context: vscode.ExtensionContext
	) {
		super(idMaker, eventEmitter, cfg, context);
		this.o = cfg.storage.files;
	}

	init(targetPath?: string): void {
		if (targetPath) this.setWatch(targetPath);
		else vscode.workspace.workspaceFolders!.forEach(workspace =>
			this.setWatch(this.getWorkspaceFolderRelativePattern(workspace))
		);
	}

	getWorkspaceFolderRelativePattern(workspace: vscode.WorkspaceFolder): vscode.RelativePattern {
		return new vscode.RelativePattern(
			this.getFullPathToSubfolder(workspace),
			`*${this.cfg.storage.files.defaultContentFileExtension}`
		);
	}

	getWatcherInstance(pattern: vscode.GlobPattern) {
		const watcher = vscode.workspace.createFileSystemWatcher(
			pattern,
			true,
			false,
			true
		);
		watcher.onDidChange(this.onChange.bind(this));
		return watcher;
	}

	onChange(path) {
		console.log('change detected');
		this.generateCustomEvent(path, 'change');
	}

	setWatch(pattern: vscode.GlobPattern): void {
		this.watcherService.set(pattern, this.getWatcherInstance(pattern));
	}

	stopWatch(pattern: vscode.GlobPattern): void {
		for (const watcher of this.watcherService.values()) {
			watcher.dispose();
		}
	}
}
