import * as React from 'react';
import {resourceIcons} from './resources';

export const SVGResourceIcon = ({kind, x, y, width, height, customStyle}: {kind: string; x?: number, y?: number, width?: number, height?: number, customStyle?: React.CSSProperties}) => {
    if (kind === 'node') {
        return <image x={x} y={y} width={width} height={height} href={'../../../assets/images/infrastructure_components/' + kind + '.svg'} style={{padding: '2px', width: '40px', height: '32px', ...customStyle}} />;
    }
    const i = resourceIcons.get(kind);
    if (i !== undefined) {
        return <image x={x} y={y} width={width} height={height} href={'../../../assets/images/resources/' + i + '.svg'} style={{padding: '2px', width: '40px', height: '32px', ...customStyle}} />;
    }
    if (kind === 'Application') {
        return <image  className={`icon argo-icon-application`} style={customStyle} />;
    }
    const initials = kind.replace(/[a-z]/g, '');
    const n = initials.length;
    const style: React.CSSProperties = {
        display: 'inline-block',
        verticalAlign: 'middle',
        padding: `${n <= 2 ? 2 : 0}px 4px`,
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        backgroundColor: '#8FA4B1',
        textAlign: 'center',
        lineHeight: '30px',
        ...customStyle
    };
    return (
        <div style={style}>
            <span style={{color: 'white', fontSize: `${n <= 2 ? 1 : 0.6}em`}}>{initials}</span>
        </div>
    );
};
