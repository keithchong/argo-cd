import * as classNames from 'classnames';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { BehaviorSubject, fromEvent, merge, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

export interface DropDownPropsSvg {
    isMenu?: boolean;
    y?: number;
    anchor: React.ComponentType;
    children: React.ReactNode | (() => React.ReactNode);
    qeId?: string;
}

export interface DropDownStateSvg {
    opened: boolean;
    left: number;
    top: number;
}

require('./dropdown.scss');

const dropDownOpened = new BehaviorSubject<DropDownSvg>(null);

export class DropDownSvg extends React.Component<DropDownPropsSvg, DropDownStateSvg> {
    private el: SVGGElement;
    private content: SVGGElement;
    private subscriptions: Subscription[];

    constructor(props: DropDownPropsSvg) {
        super(props);
        this.state = { opened: false, left: 0, top: props.y};
    }

    public render() {
        let children: React.ReactNode = null;
        if (typeof this.props.children === 'function') {
            if (this.state.opened) {
                const fun = this.props.children as () => React.ReactNode;
                children = fun();
            }
        } else {
            children = this.props.children as React.ReactNode;
        }

        return (
            <g className='argo-dropdown' ref={(el) => this.el = el}>
                <g qe-id={this.props.qeId} className='argo-dropdown__anchor' onClick={(event) => { this.open(); event.stopPropagation(); }}>
                    <this.props.anchor/>
                </g>
                {ReactDOM.createPortal((
                    <g className={classNames('argo-dropdown__content', { 'opened': this.state.opened, 'is-menu': this.props.isMenu })}
                        style={{bottom: this.state.top, left: this.state.left}}
                        ref={(el) => this.content = el}>
                        {children}
                    </g>
                ), document.body)}
            </g>
        );
    }

    public componentWillMount() {
        this.subscriptions = [merge(
            dropDownOpened.pipe(filter((dropdown) => dropdown !== this)),
            fromEvent(document, 'click').pipe(filter((event: Event) => {
                return this.content && this.state.opened && !this.content.contains(event.target as Node) && !this.el.contains(event.target as Node);
            })),
        ).subscribe(() => {
            this.close();
        }), fromEvent(document, 'scroll', {passive: true}).subscribe(() => {
            if (this.state.opened && this.content && this.el) {
                this.setState(this.refreshState());
            }
        })];
    }

    public componentWillUnmount() {
        (this.subscriptions || []).forEach((s) => s.unsubscribe());
        this.subscriptions = [];
    }

    public close() {
        this.setState({ opened: false });
    }

    private refreshState() {
        const anchor = this.el.querySelector('.argo-dropdown__anchor') as HTMLElement;
        const {top, left} = anchor.getBoundingClientRect();
        const anchorHeight = anchor.offsetHeight + 2;

        const newState = { left: this.state.left, top: this.state.top, opened: this.state.opened };
        // Set top position
        if (top + this.content.getBoundingClientRect().height + anchorHeight > window.innerHeight) {
            newState.top = top - this.content.getBoundingClientRect().height - 2;
        } else {
            newState.top = top + anchorHeight;
        }

        // Set left position
        if (left > window.innerWidth) {
            newState.left = left  + anchor.offsetWidth;
        } else {
            newState.left = left;
        }
        return newState;
    }

    private open() {
        if (!this.content || !this.el) {
            return;
        }

        const newState = this.refreshState();
        newState.opened = true;
        this.setState(newState);
    }
}
