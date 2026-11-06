/** Kiln components: plain DOM functions on window.Kiln, each returning an element to append. */
export interface ButtonProps { label: string; variant?: 'primary' | 'quiet'; disabled?: boolean; onClick?: (e: MouseEvent) => void }
export declare function Button(props: ButtonProps): HTMLButtonElement;
export interface TagProps { label: string; tone?: 'neutral' | 'clay' | 'glaze' }
export declare function Tag(props: TagProps): HTMLSpanElement;
export interface NoticeProps { title?: string; body?: string; tone?: 'glaze' | 'clay' }
export declare function Notice(props: NoticeProps): HTMLDivElement;
declare global { interface Window { Kiln: { Button: typeof Button; Tag: typeof Tag; Notice: typeof Notice } } }
