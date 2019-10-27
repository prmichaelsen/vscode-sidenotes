import * as vscode from 'vscode';
import Commands from './commands';
import { EventEmitter } from 'events';//TODO: use vScode eventemitter
import { ICfg } from './cfg';
import { IDictionary, MapDictionary } from './dictionary';
import Styler from './styler';
import { IStorageService, FileStorage } from './storageService';
import { IEditorService, VscodeEditor, TyporaEditor } from './editorService';
import { VscodeChangeTracker, FSWatchChangeTracker, FsWatcher, ChokidarChangeTracker, IChangeData, IWatch } from './watcher';
import { ISidenote, SidenoteFactory, SidenoteBuilder, Inspector, CreationScenario } from './sidenote';
import SidenoteProcessor from './sidenoteProcessor';
import Anchorer from './anchorer';
import UuidMaker from './idMaker';
import { MarkerUtils, ActiveEditorUtils } from './utils';
import Pruner from './pruner';
import Designer from './designer';
import Scanner, { IScanResultData } from './scanner';
import { FSWatcher } from 'chokidar';

// TODO import all interfaces from single file (which will do rexporting)
// TODO JSDoc

export default class App {
	private styler: Styler<ISidenote>
	private sidenoteProcessor: SidenoteProcessor
	private eventEmitter: EventEmitter
	private commands: Commands

	constructor(private cfg: ICfg, private context: vscode.ExtensionContext) {
		this.context = context;
		this.cfg = cfg;
		this.wire();
		this.checkRequirements();
		this.registerCommands();
		this.setEventListeners();
	}

	wire() {
		const uuidMaker = new UuidMaker;
		const eventEmitter = new EventEmitter;
		const pool = new MapDictionary<ISidenote>();
		const activeEditorUtils = new ActiveEditorUtils(this.context, this.cfg);
		const markerUtils = new MarkerUtils(uuidMaker, this.cfg);
		const scanner = new Scanner(markerUtils, activeEditorUtils);

		const vscodeChangeTracker = new VscodeChangeTracker(uuidMaker, eventEmitter, this.context);
		const chokidarChangeTracker = new ChokidarChangeTracker(uuidMaker, eventEmitter, this.cfg, this.context);

		const watchPool = new MapDictionary<IWatch>();
		const fileWatcher = new FsWatcher();
		const watchChangeTracker = new FSWatchChangeTracker(uuidMaker, eventEmitter, this.cfg, this.context, fileWatcher, watchPool);

		const editorService = new TyporaEditor(chokidarChangeTracker, activeEditorUtils);
		// const editorService = new TyporaEditor(watchChangeTracker, activeEditorUtils);
		// const editorService = new VscodeEditor(vscodeChangeTracker);
		const storageService = new FileStorage(activeEditorUtils, this.cfg);
		const anchorer = new Anchorer(markerUtils, activeEditorUtils, scanner, this.cfg);
		const inspector = new Inspector;
		const designer = new Designer(markerUtils, inspector, activeEditorUtils, scanner, this.cfg);
		const sidenoteFactory = new SidenoteFactory(uuidMaker, anchorer, storageService, designer, activeEditorUtils, SidenoteBuilder);
		const sidenoteProcessor = new SidenoteProcessor(storageService, anchorer, editorService, sidenoteFactory, pool, designer);
		const styler = new Styler<ISidenote>(pool, this.cfg);
		const pruner = new Pruner(pool, sidenoteProcessor, inspector);
		const commands = new Commands(styler, pruner, sidenoteProcessor, scanner, pool);


		this.styler = styler;
		this.sidenoteProcessor = sidenoteProcessor;
		this.eventEmitter = eventEmitter;
		this.commands = commands;
	}

	checkRequirements() {
		if (this.sidenoteProcessor.storageService instanceof FileStorage
			&& !vscode.workspace.workspaceFolders
		) {
			throw new Error('Adding notes requires an open folder.'); // TODO only if FileStorage service is used
		}

		if (!vscode.window.activeTextEditor) {
			throw new Error('active text editor is undefined');
		}
	}

	setEventListeners() {
		this.eventEmitter.on('sidenoteDocumentChange', async (changeData: IChangeData) => {
			// event is generated by editorService after onDidSaveDocument
			const sidenote = await this.sidenoteProcessor.get({ id: changeData.id });
			this.sidenoteProcessor.update(sidenote);
			this.styler.updateDecorations();
		})
		// действия update и update decorations должны выполяться последовательно, т.е. должны быть в одной функции
		// требуется обращение к styler, поэтому не можем разместить ниже styler,
		// или в самом styler, т.к. styler у нас generic, а тут одно действий происходит над конкретным типом
		// надо либо весь styler переписать на ISidenote,
		// либо присвоить sidenote конкретный тип ISidenote перед выполнением update (вряд ли получится)
		// const sidenote = this.pool.get(id) as unknown as ISidenote;
	}

	registerCommands() {
		// const self = this;
		return this.context.subscriptions.push(
			vscode.commands.registerCommand('sidenotes.annotate', this.commands.run, this.commands),
			vscode.commands.registerCommand('sidenotes.display', this.commands.initAnchors, this.commands),
			vscode.commands.registerCommand('sidenotes.delete', this.commands.delete, this.commands),
			vscode.commands.registerCommand('sidenotes.pruneBroken', this.commands.prune.bind(this, 'broken'), this.commands),
			vscode.commands.registerCommand('sidenotes.pruneEmpty', this.commands.prune.bind(this, 'empty'), this.commands),
			vscode.commands.registerCommand('sidenotes.temp', this.commands.temp, this.commands),
			vscode.commands.registerCommand('sidenotes.internalize', this.commands.internalize, this.commands)
		)
	}
}