import * as vscode from 'vscode';
import ChangeTracker from './changeTracker';
import * as path from 'path';
import {
	EventEmitter,
	ICfg,
	IChangeData,
	IIdMaker,
} from '../types';

export type OFileChangeTracker = {
	storage: {
		files: {
			notesSubfolder: string
		}
	}
}
// TODO использовать VSOкоdовский вотчер? https://code.visualstudio.com/api/references/vscode-api#FileSystemWatcher

// 2 варианта: можно установить слежение за всей папкой файлов сразу и по filename в лисенере вычислять id, какой из них изменился
// это больше похоже на случай есл  используем vscodechangetracker
// либо поддерживать pool watch ей (добавлять в пул при открытии документа)
// т.е. независимый watch для каждого файла. плюс - сразу можно рассчитать id для вотча и не гонять match на change каждый раз

export default abstract class FileChangeTracker extends ChangeTracker {
	abstract watcherService;

	private o:  {
		notesSubfolder: string
	}

	constructor(
		idMaker: IIdMaker,
		eventEmitter: EventEmitter,
		public cfg: OFileChangeTracker,
		public context: vscode.ExtensionContext
	) {
		super(idMaker, eventEmitter);
		this.o = cfg.storage.files;
	}

	getFullPath(workspace) {
		return path.join(workspace.uri.fsPath, this.o.notesSubfolder);
	}

	onWorkspaceChange(event: vscode.WorkspaceFoldersChangeEvent) {
		if (event.added) event.added.forEach(workspace => this.setWatch(this.getFullPath(workspace)))
		if (event.removed) event.removed.forEach(workspace => this.stopWatch(this.getFullPath(workspace)))
	}

	initListeners() {
		vscode.workspace.onDidChangeWorkspaceFolders(this.onWorkspaceChange.bind(this), this.context.subscriptions);
	}

	abstract init(targetPath?: string): void
	abstract setWatch(path: string): void
	abstract stopWatch(path: string): void

}
