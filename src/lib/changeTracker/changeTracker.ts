import {
	IIdMaker,
	EventEmitter,
	IFileChangeTrackerCfg,
	IVscodeChangeTrackerCfg
} from '../types';

import * as path from 'path';

// TODO update styles on file delete (delete corresponding anchor?)
export type IChangeTrackerCfg = IFileChangeTrackerCfg | IVscodeChangeTrackerCfg;

export interface IChangeData {
	id: string
}

export interface IChangeTracker {
	eventEmitter: EventEmitter
	generateCustomEvent(fileName: string, event: string): void
	dispatch(changeData: IChangeData): void
	init(path?: String): void
}

export default abstract class ChangeTracker {
	constructor(
		public idMaker: IIdMaker,
		public eventEmitter: EventEmitter
	) {
		this.idMaker = idMaker;
		this.eventEmitter = eventEmitter;
	}

	generateCustomEvent(fileName: string, event:string): void {;
		const changeData = this.processEventData({ event, fileName });
		if (changeData) this.dispatch(changeData);
	}

	dispatch(changeData: IChangeData): void {
		this.eventEmitter.emit('sidenoteDocumentChange', changeData);
	}

	processEventData(eventData): IChangeData|undefined {
		const id = this.getIdFromFileName(eventData.fileName);
		if (id) {
			const changeData = { id	};
			return changeData;
		}
	}

	protected getIdFromFileName(fileName: string): string|null {
		const match = fileName.match(this.idMaker.ID_REGEX)
		if (match) return match[0];
		return null;
	}


}
