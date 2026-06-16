import { Container, type SelectItem, SelectList } from "@oh-my-pi/pi-tui";
import { getSelectListTheme } from "../theme/theme";
import { DynamicBorder } from "./dynamic-border";

export class ProfileSelectorComponent extends Container {
	#selectList: SelectList;

	constructor(profiles: string[], currentProfile: string, onSelect: (name: string) => void, onCancel: () => void) {
		super();
		const items: SelectItem[] = profiles.map(name => ({
			value: name,
			label: name,
			description: name === currentProfile ? "(active)" : undefined,
		}));
		this.addChild(new DynamicBorder());
		this.#selectList = new SelectList(items, Math.min(items.length, 12), getSelectListTheme());
		this.#selectList.onSelect = item => onSelect(item.value);
		this.#selectList.onCancel = onCancel;
		this.addChild(this.#selectList);
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.#selectList;
	}
}
