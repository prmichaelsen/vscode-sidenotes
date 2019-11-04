import Dictionary from './dictionary';
import { IDictionary, IHasIdProperty } from '../types';

export default class ArrayDictionary<T extends IHasIdProperty>
	extends Dictionary<T>
	implements IDictionary<T> {

	list: T[];

	constructor() {
		super();
		this.list = [];
	}

	add(item) {
		this.list.push(item);
		return this;
	}

	get(id) {
		return this.list.find(el => el.id === id);
	}

	delete(id) {
		this.list.splice(this.list.findIndex(el => el.id === id), 1);
		return this;
	}

	each(cb) {
		this.list.forEach((prop, key) => {
			cb(prop);
		});
	}

	clear() {
		this.list.length = 0;
		return this;
	}
	// prune(cb) {
	// 	this.list.forEach((el, i, arr) => { if (cb(el)) arr.splice(i, 1); });
	// 	return this.list;
	// 	// this.list = this.list.filter((...rest)=> !cb(...rest)) // invert callback function result to delete elements for which cb returns true
	// }
}