import {
	CancellationToken,
	ExtensionContext,
	Hover,
	HoverProvider,
	Position,
	ProviderResult,
	TextDocument,
	TextEditor,
	commands,
	languages,
	window,
	workspace,
} from 'vscode';
import { DictionaryRepository, MapRepository } from './repository';
import {
	DocumentInitializableSidenotesRepository,
	SidenotesDecorator,
	SidenotesDictionary,
	SidenotesRepository,
} from './types';
import { EditorUtils, MarkerUtils } from './utils';
import Errors, { ErrorHandlers } from './errors';
import { FileStorage, StorageService } from './storageService';
import { HasEditorReference, Initializable } from './mixins';
import { Inspector, SidenoteBuilder, SidenoteFactory } from './sidenote';
import { ReferenceContainer, ReferenceController } from './referenceContainer';
import {
	ShellEditorService,
	SystemDefaultEditorService,
	VscodeEditorService,
} from './editorService';

import Actions from './actions';
import Anchorer from './anchorer';
import { Cfg } from './cfg';
import Decorator from './decorator';
import EditorServiceController from './editorServiceController';
import { EventEmitter } from 'events';
import { MapDictionary } from './dictionary';
import Pruner from './pruner';
import Scanner from './scanner';
import SidenoteProcessor from './sidenoteProcessor';
import Signature from './signature';
import SnEvents from './events';
import SnFileSystem from './fileSystem';
import Styler from './styler';
import UserInteraction from './userInteraction';
import UuidProvider from './idProvider';
import { VSCodeFileSystemWatcherMaker } from './changeTracker';
import VsOutputChannel from './outputChannel';
import { copyProperties } from './utilityFunctions';
import { NoteLinkProvider } from './NoteLinkProvider';

export type OApp = {
	app: {
		hoverToolbar: boolean;
	};
};

export default class App {
	public actions!: Actions;
	private events!: SnEvents;
	private eventEmitter!: EventEmitter;
	private storageService!: StorageService;

	constructor(private cfg: Cfg, private context: ExtensionContext) {
		this.init();
	}

	async init(): Promise<void> {
		await this.compose();
		this.checkRequirements();
		this.registerCommands();
		this.setEventListeners();
		this.registerProviders();
		// this.utils.cycleEditors(this.actions.scan.bind(this.actions));
		this.actions.scan();
	}

	async compose(): Promise<void> {
		const uuidMaker = new UuidProvider();

		const eventEmitter = new EventEmitter();

		const outputChannel = new VsOutputChannel(`Sidenotes`);
		const on = new ErrorHandlers(outputChannel);
		const errors = new Errors(outputChannel);

		const userInteraction = new UserInteraction(this.cfg, errors);

		const signature = new Signature(userInteraction, this.cfg);

		const MixinedMapDictionary = HasEditorReference(
			Initializable(MapDictionary),
		);
		// 🕮 <cyberbiont> bd961532-0e0f-4b5f-bb70-a286acdfab37.md

		// const parentContainer: { parent?: TextDocument } = {};

		const poolRepository: DocumentInitializableSidenotesRepository =
			new MapRepository(
				{
					// adding static create method
					...MixinedMapDictionary,
					create(): SidenotesDictionary {
						const dictionary: SidenotesDictionary = new MixinedMapDictionary();
						// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
						dictionary.editor = window.activeTextEditor!;
						return dictionary;
					},
				},
				new WeakMap(),
			);

		/* 		class RR<T, D> {
			constructor(a: number, b: string | undefined) {}

			async get(arg: T): Promise<this> {
				return this;
			}
		}
		const x = await new RR(1, 'e').get(1); */

		const editorController = await new ReferenceController(
			ReferenceContainer,
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			async () => window.activeTextEditor!,
		).update();
		const editor: TextEditor = editorController.getReference();

		const poolController = await new ReferenceController(
			ReferenceContainer,
			async (key: TextDocument) => poolRepository.obtain(key),
		).update(editor.document);
		const pool: SidenotesDictionary = poolController.getReference();

		// TODO move to configuration
		const getAlternativeStylesCfg = (): Cfg => {
			const altCfg: Cfg = JSON.parse(JSON.stringify(this.cfg));
			altCfg.anchor.styles.settings.hideMarkers =
				!this.cfg.anchor.styles.settings.hideMarkers;
			// altCfg.anchor.styles.settings.before = 'alternative config ';
			return altCfg;
		};

		const decoratorsCollection: Record<string, Decorator> = {
			default: new Decorator(pool, this.cfg),
			alternative: new Decorator(pool, getAlternativeStylesCfg()),
		};

		const decoratorController = await new ReferenceController(
			ReferenceContainer,
			async (key: keyof typeof decoratorsCollection) =>
				decoratorsCollection[key],
		).update(`default`);

		const decorator: SidenotesDecorator = decoratorController.getReference();

		const editorUtils = new EditorUtils(editor, this.cfg);
		const markerUtils = new MarkerUtils(uuidMaker, signature, this.cfg);

		const utils: MarkerUtils & EditorUtils = Object.create(null);

		copyProperties(utils, editorUtils);
		copyProperties(utils, markerUtils);

		const scanner = new Scanner(editor.document, utils);

		const fileSystem = new SnFileSystem(scanner, utils, this.cfg);

		const changeTracker = new VSCodeFileSystemWatcherMaker(
			uuidMaker,
			eventEmitter,
			utils,
			this.cfg,
			this.context,
		);
		// 🕮 <cyberbiont> a1f2b34f-bad3-45fb-8605-c5a233e65933.md
		const editorServiceController = new EditorServiceController(
			new ShellEditorService(changeTracker),
			new SystemDefaultEditorService(changeTracker),
			new VscodeEditorService(changeTracker),
			this.cfg,
		);

		const storageService = new FileStorage(
			editorServiceController,
			utils,
			fileSystem,
			signature,
			this.cfg,
		);

		const anchorer = new Anchorer(editor, utils, scanner, this.cfg);

		const inspector = new Inspector(utils);
		const styler = new Styler(inspector, this.cfg);

		const sidenoteProcessor = new SidenoteProcessor(
			storageService,
			anchorer,
			pool,
			styler,
			inspector,
			userInteraction,
			signature,
		);

		const pruner = new Pruner(pool, sidenoteProcessor, inspector);

		const sidenoteFactory = new SidenoteFactory(
			uuidMaker,
			anchorer,
			storageService,
			styler,
			utils,
			scanner,
			SidenoteBuilder,
			inspector,
			signature,
			this.cfg,
		);

		const sidenotesRepository: SidenotesRepository = new DictionaryRepository(
			sidenoteFactory,
			pool,
		);

		const actions = new Actions(
			outputChannel,
			styler,
			inspector,
			storageService,
			pool,
			poolController,
			pruner,
			scanner,
			sidenoteProcessor,
			sidenotesRepository,
			decorator,
			decoratorController,
			utils,
			userInteraction,
			signature,
			fileSystem,
			this.cfg,
		);

		const events = new SnEvents(
			actions,
			this.cfg,
			pool,
			scanner,
			sidenoteProcessor,
			decorator,
			utils,
			editorController,
			poolController,
			poolRepository,
		);

		this.actions = actions;
		this.eventEmitter = eventEmitter;
		this.storageService = storageService;
		this.events = events;
	}

	checkRequirements(): void {
		if (this.storageService.checkStartupRequirements)
			this.storageService.checkStartupRequirements();

		if (!window.activeTextEditor)
			throw new Error(`active text editor is undefined`);
	}

	setEventListeners(): void {
		window.onDidChangeActiveTextEditor(
			this.events.onEditorChange,
			this.events,
			this.context.subscriptions,
		);
		workspace.onDidChangeTextDocument(
			this.events.onDidChangeTextDocument,
			this.events,
			this.context.subscriptions,
		);
		this.eventEmitter.on(
			`sidenoteDocumentChange`,
			this.events.onSidenoteDocumentChange.bind(this.events),
		);
	}

	registerCommands(): number {
		return this.context.subscriptions.push(
			commands.registerCommand(
				`sidenotes.annotate`,
				this.actions.run,
				this.actions,
			),
			commands.registerCommand(
				`sidenotes.annotateCode`,
				this.actions.run.bind(this.actions, { useCodeFence: true }),
				this.actions,
			),
			commands.registerCommand(
				`sidenotes.annotatePickExt`,
				this.actions.run.bind(this.actions, { selectExtensionBy: `pick` }),
				this.actions,
			),
			commands.registerCommand(
				`sidenotes.annotateInputExt`,
				this.actions.run.bind(this.actions, { selectExtensionBy: `input` }),
				this.actions,
			),
			commands.registerCommand(
				`sidenotes.delete`,
				this.actions.delete,
				this.actions,
			),
			commands.registerCommand(
				`sidenotes.wipeAnchor`,
				this.actions.wipeAnchor,
				this.actions,
			),
			commands.registerCommand(
				`sidenotes.pruneBroken`,
				this.actions.prune.bind(this.actions, `broken`),
			),
			commands.registerCommand(
				`sidenotes.pruneEmpty`,
				this.actions.prune.bind(this.actions, `empty`),
			),
			commands.registerCommand(
				`sidenotes.refresh`,
				this.actions.refresh,
				this.actions,
			),
			commands.registerCommand(
				`sidenotes.showMarkers`,
				this.actions.switchStylesCfg,
				this.actions,
			),
			commands.registerCommand(
				`sidenotes.switchActiveSignature`,
				this.actions.switchActiveSignature,
				this.actions,
			),
			commands.registerCommand(
				`sidenotes.changeSidenoteSignature`,
				this.actions.changeSidenoteSignature,
				this.actions,
			),
			commands.registerCommand(
				`sidenotes.migrate`,
				this.actions.migrate,
				this.actions,
			),
			commands.registerCommand(
				`sidenotes.extraneous`,
				this.actions.extraneous,
				this.actions,
			),
		);
	}

	registerProviders(): void {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const app = this;
		// 🕮 <cyberbiont> 59cd0823-4911-4a88-a657-88fcd4f1dcba.md
		if (this.cfg.app.hoverToolbar)
			languages.registerHoverProvider(
				// '*',
				{
					scheme: `file`,
				},
				new (class implements HoverProvider {
					provideHover(
						document: TextDocument,
						position: Position,
						token: CancellationToken,
					): ProviderResult<Hover> {
						return app.actions.getHover(document, position);
					}
				})(),
			);
		const utils = app.actions.sidenoteProcessor.fileStorage.utils;
		const provider = new NoteLinkProvider(utils);
		app.context.subscriptions.push(
			languages.registerDocumentLinkProvider('*', provider)
		);
	}
}
