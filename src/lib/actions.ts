import * as vscode from 'vscode';
import {
	IScanData,
	ISidenote,
	Inspector,
	Pruner,
	Scanner,
	SidenoteProcessor,
	SidenotesDictionary,
	SidenotesStyler,
	IChangeTracker,
	IEditorService,
	Designer,
	DocumentsController,
	EventEmitter,
	IChangeData,
	SidenotesPoolDriver,
	ICfg,
	MarkerUtils
} from './types';

export default class Actions {
	constructor(
		public styler: SidenotesStyler,
		private pruner: Pruner,
		private sidenoteProcessor: SidenoteProcessor,
		private scanner: Scanner,
		public pool: SidenotesDictionary,
		private inspector: Inspector,
		private editor: vscode.TextEditor,
		private utils: MarkerUtils,
		private sidenotesPoolDriver: SidenotesPoolDriver,
		private changeTracker: IChangeTracker,
		private designer: Designer,
		private documentsController: DocumentsController< SidenotesDictionary>,
		private cfg: ICfg
	) {}

	// eventListeners
	async onEditorChange(editor: vscode.TextEditor) {
		await this.documentsController.onEditorChange(editor.document);
		this.pool.each((sidenote: ISidenote) => {
			sidenote.anchor.editor = this.editor;
		});
		this.scanDocumentAnchors();
		// this.styler.updateDecorations();
	};

	onVscodeEditorChange (editor: vscode.TextEditor) {
		// add additional check to prevent triggering scan on sidenote files
		if (this.changeTracker.getIdFromFileName(editor.document.fileName)) return;
		this.onEditorChange(editor);
	};

	async onSidenoteDocumentChange (changeData: IChangeData) {
		// event is generated by editorService after onDidSaveDocument
		// const sidenote = await this.sidenoteProcessor.getOrCreate({ id: changeData.id, ranges: [] });
		const sidenote = await this.sidenotesPoolDriver.get(changeData.id);
		if (!sidenote) throw new Error('sidenote being edited is not present in pool');
		// тут надо вызвать просто get на самом деле)
		this.sidenoteProcessor.updateContent(sidenote);
		this.styler.updateDecorations();
		// действия update и update decorations должны выполяться последовательно, т.е. должны быть в одной функции
		// требуется обращение к styler, поэтому не можем разместить ниже styler,
		// или в самом styler, т.к. styler у нас generic, а тут одно действий происходит над конкретным типом
		// надо либо весь styler переписать на ISidenote,
		// либо присвоить sidenote конкретный тип ISidenote перед выполнением update (вряд ли получится)
		// const sidenote = this.pool.get(id) as unknown as ISidenote;
	};

	async onDidChangeTextDocument (event: vscode.TextDocumentChangeEvent) {
		// if (activeEditor && event.document === activeEditor.document)
		// if (timeout) {
		// 	clearTimeout(timeout);
		// 	timeout = undefined;
		// }
		// timeout = setTimeout(updateDecorations, 500);

		const updateDecorationRange = async (scanData: IScanData): Promise<ISidenote> => {
			const sidenote = await this.sidenotesPoolDriver.obtain(scanData);
			sidenote.decorations = this.designer.get(
				sidenote, scanData.ranges
			);
			return sidenote;
		}

		if (!event.contentChanges.some(
			change => {
				// при удалении мы не можем отследить, что именно было удалено (с-вот text = '')
				// поэтому придется обрабатывать все удаления
				// rangeLength содержит длину удаленного фрагемнта и 0 если ничего не было удалено
				const condition = (
					(change.rangeLength &&
						change.rangeLength >= this.utils.BARE_MARKER_SYMBOLS_COUNT) ||
					(this.utils.BARE_MARKER_SYMBOLS_COUNT &&
						change.text.indexOf(this.cfg.anchor.marker.salt) !== -1) // includes marker
				);
				return condition;
			}
		)) return;

		// rescan positions for decorations in current document
		const scanResults = this.scanner.getIdsFromText();
		if (!scanResults) return;

		await Promise.all(scanResults.map(updateDecorationRange));

		this.styler.updateDecorations();
	};


	async scanDocumentAnchors(): Promise<void> {
		// надо просто знать, если уже уже пул для этого документа или нет, если есть, то не пересканируем, просто апдейтим декорации
		// if (!this.pool.getIsInitialized()) {
			try {
				const scanResults = this.scanner.getIdsFromText();
				if (!scanResults) {
					// vscode.window.showInformationMessage('no sidenotes found in current document');
					return;
				}

				await Promise.all(scanResults.map(this.sidenotesPoolDriver.create, this.sidenotesPoolDriver));

				// this.pool.setIsInitialized(true);

			} catch(e) {
				console.log(e);
			}
		// }

		this.styler.updateDecorations();
	}

	async run(): Promise<void> {
		try {
			const scanData = this.scanner.scanLine();

			let obtainedSidenote = await this.sidenotesPoolDriver.obtain(scanData);

			let sidenote: ISidenote | undefined;
			if (this.inspector.isBroken(obtainedSidenote)) {
				sidenote = await this.sidenoteProcessor.handleBroken(obtainedSidenote);
			} else sidenote = obtainedSidenote;

			if (sidenote) await this.sidenoteProcessor.open(sidenote);

			this.styler.updateDecorations();

		} catch(e) {
			console.log(e);
		}
	}

	async delete(): Promise<void> {
		const scanData = this.scanner.scanLine();
		if (!scanData) {
			vscode.window.showInformationMessage('There is no sidenotes attached at current cursor position');
			return;
		}

		// TODO ask user if he wants to delete anchor only or associated file too (in this case scan for other remaining anchors with this id in workspace and delete them);

		let sidenote = await this.sidenotesPoolDriver.obtain(scanData);
		await this.sidenoteProcessor.delete(sidenote);

		this.styler.updateDecorations();
	}

	async prune(category) {
		this.scanDocumentAnchors();

		switch (category) {
			case 'broken': await this.pruner.pruneBroken(); break;
			case 'empty': await this.pruner.pruneEmpty(); break;
			default: await this.pruner.pruneAll();
		}

		this.styler.updateDecorations();
	}

	reset() {
		this.styler.resetDecorations();
		this.pool.clear();
	}

	async migrate() {
		// только для FileService
		// TODO если используется другой тип StoragService, не регистрируем эту команду просто

		// TODO вынести в класс userInteractions
		const options: vscode.OpenDialogOptions = {
			canSelectMany: false,
			canSelectFolders: true,
			// defaultUri: this.getCurrentWorkspacePath() //TODO default URI
			openLabel: 'Select folder to look for missing sidenotes',
			// filters: {
			// 	'Text files': ['txt'],
			// 	'All files': ['*']
			// }
		};

		//TODO try to read files for all sidenotes and report statictics if there are ny broken sidenotes

		const lookupUri = await vscode.window.showOpenDialog(options);
		if (!lookupUri) return;

		const ids = Array.from(await this.scanner.scanCurrentWorkspace());

		// TODO build sidenote instances from ids to check if they are broken

		const results = await Promise.all(
			ids.map(async id => {
				return this.sidenoteProcessor.storageService.lookup!(id, lookupUri[0].fsPath);
			})
		);
		const successfulResults = results.filter(result => result); // TODO map to just file names
		const message = successfulResults.length === 0 ?
			'No missing files were found in specified directory ' :
			`The following files have been found and copied to the current workspace:
			${successfulResults.join(',\n')}`;
		vscode.window.showInformationMessage(message);


	}

	toggleAnchorsFolding() {// TODO

	}

	async cleanExtraneous() { //TODO
		// только для FileService
		// const ids = await this.scanner.scanCurrentWorkspace();
		// const sidenoteFiles = await this.scanner.scanCurrentSidenotesDir();
		// sidenoteFiles.forEach(filepath => {
		// 	const id = getIdFromFilename(filepath);
		// 	if(!ids.has(id)) sidenoteProcessor.storageService.delete(id);
		// })
	}

	async internalize() {
		// TODO comment regexp match document for content, select and toggle comment)
		if (!this.editor) return;
		const scanData = this.scanner.scanLine();
		if (!scanData) {
			vscode.window.showInformationMessage('There is no sidenotes attached at current cursor position');
			return;
		}
		const sidenote = await this.sidenotesPoolDriver.obtain(scanData);
		const content = sidenote.content;
		if (content) {
			await this.sidenoteProcessor.delete(sidenote);
			await this.editor.edit(
				edit => { edit.insert(vscode.window.activeTextEditor!.selection.anchor, content); },
				{ undoStopAfter: false, undoStopBefore: false }
			);
		}
		// TODO get range for comment toggle comment

		this.styler.updateDecorations();
	}
}
