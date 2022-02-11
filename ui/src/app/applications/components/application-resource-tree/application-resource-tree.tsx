import {DropDown, Tooltip} from 'argo-ui';
import * as classNames from 'classnames';
import * as dagre from 'dagre';
import * as React from 'react';
import Moment from 'react-moment';

import * as models from '../../../shared/models';

import {EmptyState} from '../../../shared/components';
import {Consumer} from '../../../shared/context';
import {ApplicationURLs} from '../application-urls';
import {ResourceIcon} from '../resource-icon';
import {ResourceLabel} from '../resource-label';
import {BASE_COLORS, ComparisonStatusIcon, getAppOverridesCount, getExternalUrls, HealthStatusIcon, HealthStatusIconSVG, isAppNode, NodeId, nodeKey} from '../utils';
import {NodeUpdateAnimation} from './node-update-animation';
import {SVGResourceIcon} from '../svg-resource-icon';
import * as moment from 'moment';
import { DropDownSvg } from './dropdown';

function treeNodeKey(node: NodeId & {uid?: string}) {
    return node.uid || nodeKey(node);
}

const color = require('color');

require('./application-resource-tree.scss');

export interface ResourceTreeNode extends models.ResourceNode {
    status?: models.SyncStatusCode;
    health?: models.HealthStatus;
    hook?: boolean;
    root?: ResourceTreeNode;
    requiresPruning?: boolean;
    orphaned?: boolean;
    isExpanded?: boolean;
}

export interface ApplicationResourceTreeProps {
    app: models.Application;
    tree: models.ApplicationTree;
    useNetworkingHierarchy: boolean;
    nodeFilter: (node: ResourceTreeNode) => boolean;
    selectedNodeFullName?: string;
    onNodeClick?: (fullName: string) => any;
    onGroupdNodeClick?: (groupedNodeIds: string[]) => any;
    nodeMenu?: (node: models.ResourceNode) => React.ReactNode;
    onClearFilter: () => any;
    showOrphanedResources: boolean;
    showCompactNodes: boolean;
    zoom: number;
    setNodeExpansion: (node: string, isExpanded: boolean) => any;
    getNodeExpansion: (node: string) => boolean;
}

interface Line {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

const NODE_WIDTH = 282;
const NODE_HEIGHT = 52;
const FILTERED_INDICATOR_NODE = '__filtered_indicator__';
const EXTERNAL_TRAFFIC_NODE = '__external_traffic__';
const INTERNAL_TRAFFIC_NODE = '__internal_traffic__';
const NODE_TYPES = {
    filteredIndicator: 'filtered_indicator',
    externalTraffic: 'external_traffic',
    externalLoadBalancer: 'external_load_balancer',
    internalTraffic: 'internal_traffic',
    groupedNodes: 'grouped_nodes'
};

// generate lots of colors with different darkness
const TRAFFIC_COLORS = [0, 0.25, 0.4, 0.6]
    .map(darken =>
        BASE_COLORS.map(item =>
            color(item)
                .darken(darken)
                .hex()
        )
    )
    .reduce((first, second) => first.concat(second), []);

function getGraphSize(nodes: dagre.Node[]): {width: number; height: number} {
    let width = 0;
    let height = 0;
    nodes.forEach(node => {
        width = Math.max(node.x + node.width, width);
        height = Math.max(node.y + node.height, height);
    });
    return {width, height};
}

function filterGraph(app: models.Application, filteredIndicatorParent: string, graph: dagre.graphlib.Graph, predicate: (node: ResourceTreeNode) => boolean) {
    const appKey = appNodeKey(app);
    let filtered = 0;
    graph.nodes().forEach(nodeId => {
        const node: ResourceTreeNode = graph.node(nodeId) as any;
        const parentIds = graph.predecessors(nodeId);
        if (node.root != null && !predicate(node) && appKey !== nodeId) {
            const childIds = graph.successors(nodeId);
            graph.removeNode(nodeId);
            filtered++;
            childIds.forEach((childId: any) => {
                parentIds.forEach((parentId: any) => {
                    graph.setEdge(parentId, childId);
                });
            });
        }
    });
    if (filtered) {
        graph.setNode(FILTERED_INDICATOR_NODE, {height: NODE_HEIGHT, width: NODE_WIDTH, count: filtered, type: NODE_TYPES.filteredIndicator});
        graph.setEdge(filteredIndicatorParent, FILTERED_INDICATOR_NODE);
    }
}

function groupNodes(nodes: any[], graph: dagre.graphlib.Graph) {
    function getNodeGroupingInfo(nodeId: string) {
        const node = graph.node(nodeId);
        return {
            nodeId,
            kind: node.kind,
            parentIds: graph.predecessors(nodeId),
            childIds: graph.successors(nodeId)
        };
    }

    function filterNoChildNode(nodeInfo: {childIds: dagre.Node[]}) {
        return nodeInfo.childIds.length === 0;
    }

    // create nodes array with parent/child nodeId
    const nodesInfoArr = graph.nodes().map(getNodeGroupingInfo);

    // group sibling nodes into a 2d array
    const siblingNodesArr = nodesInfoArr
        .reduce((acc, curr) => {
            if (curr.childIds.length > 1) {
                acc.push(curr.childIds.map(nodeId => getNodeGroupingInfo(nodeId.toString())));
            }
            return acc;
        }, [])
        .map(nodeArr => nodeArr.filter(filterNoChildNode));

    // group sibling nodes with same kind
    const groupedNodesArr = siblingNodesArr
        .map(eachLevel => {
            return eachLevel.reduce(
                (groupedNodesInfo: {kind: string; nodeIds?: string[]; parentIds?: dagre.Node[]}[], currentNodeInfo: {kind: string; nodeId: string; parentIds: dagre.Node[]}) => {
                    const index = groupedNodesInfo.findIndex((nodeInfo: {kind: string}) => currentNodeInfo.kind === nodeInfo.kind);
                    if (index > -1) {
                        groupedNodesInfo[index].nodeIds.push(currentNodeInfo.nodeId);
                    }

                    if (groupedNodesInfo.length === 0 || index < 0) {
                        const nodeIdArr = [];
                        nodeIdArr.push(currentNodeInfo.nodeId);
                        const groupedNodesInfoObj = {
                            kind: currentNodeInfo.kind,
                            nodeIds: nodeIdArr,
                            parentIds: currentNodeInfo.parentIds
                        };
                        groupedNodesInfo.push(groupedNodesInfoObj);
                    }

                    return groupedNodesInfo;
                },
                []
            );
        })
        .reduce((flattedNodesGroup, groupedNodes) => {
            return flattedNodesGroup.concat(groupedNodes);
        }, [])
        .filter((eachArr: {nodeIds: string[]}) => eachArr.nodeIds.length > 1);

    // update graph
    if (groupedNodesArr.length > 0) {
        groupedNodesArr.forEach((obj: {kind: string; nodeIds: string[]; parentIds: dagre.Node[]}) => {
            const {nodeIds, kind, parentIds} = obj;
            const groupedNodeIds: string[] = [];
            nodeIds.forEach((nodeId: string) => {
                const index = nodes.findIndex(node => nodeId === node.uid || nodeId === nodeKey(node));
                if (index > -1) {
                    groupedNodeIds.push(nodeId);
                }
                graph.removeNode(nodeId);
            });
            graph.setNode(`${parentIds[0].toString()}/child/${kind}`, {
                kind,
                groupedNodeIds,
                height: NODE_HEIGHT,
                width: NODE_WIDTH,
                count: nodeIds.length,
                type: NODE_TYPES.groupedNodes
            });
            graph.setEdge(parentIds[0].toString(), `${parentIds[0].toString()}/child/${kind}`);
        });
    }
}

export function compareNodes(first: ResourceTreeNode, second: ResourceTreeNode) {
    function orphanedToInt(orphaned?: boolean) {
        return (orphaned && 1) || 0;
    }
    function compareRevision(a: string, b: string) {
        const numberA = Number(a);
        const numberB = Number(b);
        if (isNaN(numberA) || isNaN(numberB)) {
            return a.localeCompare(b);
        }
        return Math.sign(numberA - numberB);
    }
    function getRevision(a: ResourceTreeNode) {
        const filtered = (a.info || []).filter(b => b.name === 'Revision' && b)[0];
        if (filtered == null) {
            return '';
        }
        const value = filtered.value;
        if (value == null) {
            return '';
        }
        return value.replace(/^Rev:/, '');
    }
    return (
        orphanedToInt(first.orphaned) - orphanedToInt(second.orphaned) ||
        nodeKey(first).localeCompare(nodeKey(second)) ||
        compareRevision(getRevision(first), getRevision(second)) ||
        0
    );
}

function appNodeKey(app: models.Application) {
    return nodeKey({group: 'argoproj.io', kind: app.kind, name: app.metadata.name, namespace: app.metadata.namespace});
}

function renderFilteredNode(node: {count: number} & dagre.Node, onClearFilter: () => any) {
    const indicators = new Array<number>();
    let count = Math.min(node.count - 1, 3);
    while (count > 0) {
        indicators.push(count--);
    }
    return (
        <React.Fragment>
            <div className='application-resource-tree__node' style={{left: node.x, top: node.y, width: node.width, height: node.height}}>
                <div className='application-resource-tree__node-kind-icon '>
                    <i className='icon fa fa-filter' />
                </div>
                <div className='application-resource-tree__node-content-wrap-overflow'>
                    <a className='application-resource-tree__node-title' onClick={onClearFilter}>
                        clear filters to show {node.count} additional resource{node.count > 1 && 's'}
                    </a>
                </div>
            </div>
            {indicators.map(i => (
                <div
                    key={i}
                    className='application-resource-tree__node application-resource-tree__filtered-indicator'
                    style={{left: node.x + i * 2, top: node.y + i * 2, width: node.width, height: node.height}}
                />
            ))}
        </React.Fragment>
    );
}

function renderGroupedNodes(props: ApplicationResourceTreeProps, node: {count: number} & dagre.Node & ResourceTreeNode) {
    const indicators = new Array<number>();
    let count = Math.min(node.count - 1, 3);
    while (count > 0) {
        indicators.push(count--);
    }
    return (
        <React.Fragment>
            <div className='application-resource-tree__node' style={{left: node.x, top: node.y, width: node.width, height: node.height}}>
                <div className='application-resource-tree__node-kind-icon'>
                    <ResourceIcon kind={node.kind} />
                    <br />
                    <div className='application-resource-tree__node-kind'>{ResourceLabel({kind: node.kind})}</div>
                </div>
                <div className='application-resource-tree__node-content-wrap-overflow'>
                    <a className='application-resource-tree__node-title' onClick={() => props.onGroupdNodeClick && props.onGroupdNodeClick(node.groupedNodeIds)}>
                        click to show details of {node.count} collapsed {node.kind}
                    </a>
                </div>
            </div>
            {indicators.map(i => (
                <div
                    key={i}
                    className='application-resource-tree__node application-resource-tree__filtered-indicator'
                    style={{left: node.x + i * 2, top: node.y + i * 2, width: node.width, height: node.height}}
                />
            ))}
        </React.Fragment>
    );
}

function renderTrafficNode(node: dagre.Node) {
    return (
        <div style={{position: 'absolute', left: 0, top: node.y, width: node.width, height: node.height}}>
            <div className='application-resource-tree__node-kind-icon' style={{fontSize: '2em'}}>
                <i className='icon fa fa-cloud' />
            </div>
        </div>
    );
}

function renderLoadBalancerNode(node: dagre.Node & {label: string; color: string}) {
    return (
        <div
            className='application-resource-tree__node application-resource-tree__node--load-balancer'
            style={{
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height
            }}>
            <div className='application-resource-tree__node-kind-icon'>
                <i title={node.kind} className={`icon fa fa-network-wired`} style={{color: node.color}} />
            </div>
            <div className='application-resource-tree__node-content'>
                <span className='application-resource-tree__node-title'>{node.label}</span>
            </div>
        </div>
    );
}

export const describeNode = (node: ResourceTreeNode) => {
    const lines = [`Kind: ${node.kind}`, `Namespace: ${node.namespace || '(global)'}`, `Name: ${node.name}`];
    if (node.images) {
        lines.push('Images:');
        node.images.forEach(i => lines.push(`- ${i}`));
    }
    return lines.join('\n');
};

                // {/* <g transform="translate(-80, 0)">
                //       <rect fill='yellow' width={node.width} height={node.height}></rect>
                // </g> */}
                //  {/* <g fill="white" stroke="green" stroke-width="5">
                // <circle cx="0" cy="0" r="5" />
                // <circle cx="60" cy="60" r="25" />
                // </g> */}

function renderResourceNodeSVG(props: ApplicationResourceTreeProps, id: string, node: ResourceTreeNode & dagre.Node) {
    const fullName = nodeKey(node);
    let comparisonStatus: models.SyncStatusCode = null;
    let healthState: models.HealthStatus = null;
    if (node.status || node.health) {
        comparisonStatus = node.status;
        healthState = node.health;
    }
    const appNode = isAppNode(node);
    const rootNode = !node.root;
    // const zoom = 1;
    // function getViewBox(node: ResourceTreeNode & dagre.Node) : string {
    //     return (node.x) + " " + node.y  + " " + node.width*zoom + node.height*zoom;
    // }

    // const Icon = () => (
    // <svg fill={color} width={'40px'} height={'32px'}>
    //   <use xlinkHref={`${Icons}`} />
    // </svg>
//   );
    const createdAt = moment(node.createdAt || props.app.metadata.creationTimestamp).fromNow(true);

    function expandCollapse(node: ResourceTreeNode, props: ApplicationResourceTreeProps) {
        let b = !props.getNodeExpansion(node.kind +":" + node.name);
        console.log(b);
        node.isExpanded = b;
        props.setNodeExpansion(node.kind + ":" + node.name, b);
    }
        
    return (
        <>
        <g
            onClick={() => props.onNodeClick && props.onNodeClick(fullName)}
            className={classNames('application-resource-tree__node', {
                'active': fullName === props.selectedNodeFullName,
                'application-resource-tree__node--orphaned': node.orphaned
            })}
            // title={describeNode(node)}
            // style={{left: node.x, top: node.y, width: node.width, height: node.height}}>
            >  
            {/* <svg key={'graph {node.name}'} width={node.width/2}  viewBox='0 0 10 10' preserveAspectRatio="xMidYMid meet" > */}
            {/* <svg id="svg" viewBox={getViewBox(node)} transform="translate(-45, 7)"> */}

            <rect rx="4px" fill='white' x={node.x+10} y={node.y} width={node.width} height={node.height}/>
            {!rootNode && <text x={node.x+22} y={node.y + 47} style={{fontSize: '0.7em', alignContent: 'center'}} className='application-resource-tree__node-kind'>{ResourceLabel({kind: node.kind})}</text>}
            <SVGResourceIcon kind={node.kind} x={node.x+22} y={node.y+6} />
            
            <text overflow="auto" x={node.x+80} y={node.y + 25} className='application-resource-tree__node-title'>{node.name}</text>
            <rect fill='white' x={node.x + node.width} y={node.y + node.height/2-10} width='20' height='20' rx="4px" onClick={(event) => { expandCollapse(node, props); event.stopPropagation(); }}/>

            {/* <g
            className={classNames('application-resource-tree__node-kind-icon', {
                'application-resource-tree__node-kind-icon--big': rootNode
            })}>
            </g> */}
            {/* {healthState != null && <HealthStatusIconSVG state={healthState} style={{x: `${node.x+80}`, y:`${node.y + 25}`}} />} */}
            {healthState != null && <HealthStatusIconSVG state={healthState} x={node.x + 80} y={node.y + 32} />}
            
            
            <g
                className={classNames('application-resource-tree__node-status-icon', {
                    'application-resource-tree__node-status-icon--offset': rootNode
                })}>
                {node.hook && <i title='Resource lifecycle hook' className='fa fa-anchor' />}
                {healthState != null && <HealthStatusIcon state={healthState} />}
                {comparisonStatus != null && <ComparisonStatusIcon status={comparisonStatus} resource={!rootNode && node} />}
                <foreignObject>
                {appNode && !rootNode && (
                    <Consumer>
                        {ctx => (
                            <a href={ctx.baseHref + 'applications/' + node.name} title='Open application'>
                                <i className='fa fa-external-link-alt' />
                            </a>
                        )}
                    </Consumer>
                )}
                </foreignObject>
                <ApplicationURLs urls={rootNode ? props.app.status.summary.externalURLs : node.networkingInfo && node.networkingInfo.externalURLs} />
            </g>
            <svg className='application-resource-tree__node-labels-svg' preserveAspectRatio="xMaxYMax meet"
                >
                {/* <rect className='application-resource-tree__node-label-svg-rect' x={node.x + 127} y={node.y + node.height - 5} width={createdAt.length*6} height='0.8em' rx={'5px'}/>
                <rect className='application-resource-tree__node-label-svg-border' fillRule='evenodd' fillOpacity='1%' x={node.x + 127} y={node.y + node.height - 5} width={createdAt.length*6} height='0.8em' rx={'5px'}/> */}

                {node.createdAt || rootNode ? (
                    <g x={node.x + 130} y={node.y + node.height} >
                        <rect className='application-resource-tree__node-label-svg-rect' x={node.x + 127} y={node.y + node.height - 5} width={createdAt.length*6+3} height='0.8em' rx={'5px'}/>
                        <rect className='application-resource-tree__node-label-svg-border' fillRule='evenodd' fillOpacity='1%' x={node.x + 127} y={node.y + node.height - 5} width={createdAt.length*6 + 3} height='0.8em' rx={'5px'}/>

                       <text className='application-resource-tree__node-label-svg' x={node.x + 130} y={node.y + node.height + 5}>{createdAt}</text>
                    </g>
                ) : null}
                {(node.info || [])
                    .filter(tag => !tag.name.includes('Node'))
                    .slice(0, 4)
                    .map((tag, i) => (
                        <g width={tag.value.length*6+5} overflow="auto">
                            <title>{`${tag.name}:${tag.value}`}</title>
                            <rect className='application-resource-tree__node-label-svg-rect' x={node.x + 127 + (50 * (i+1))} y={node.y + node.height - 5} width={tag.value.length*6+3} height='0.8em' rx={'5px'}/>
                            <rect className='application-resource-tree__node-label-svg-border' fillRule='evenodd' fillOpacity='1%' x={node.x + 127 + (50 * (i+1))} y={node.y + node.height - 5} width={tag.value.length*6 + 3} height='0.8em' rx={'5px'}/>
                            <text x={node.x +127} dx={ 50 * (i+1) + 3} y={node.y + node.height + 5} className='application-resource-tree__node-label-svg' key={i}>
                                {tag.value}
                            </text>
                        </g>
                    ))}
                {(node.info || []).length > 4 && (
                    <Tooltip
                        content={(node.info || []).map(i => (
                            <div key={i.name}>
                                {i.name}: {i.value}
                            </div>
                        ))}
                        key={node.uid}>
                        <span className='application-resource-tree__node-label' title='More'>
                            More
                        </span>
                    </Tooltip>
                )}
            </svg>
            {props.nodeMenu && (
                <g className='application-resource-tree__node-menu'>
                    {/* <svg onClick={(event) => {props.nodeMenu(node); alert('click!'); event.stopPropagation();}} x={node.x + node.width-9} y={node.y + node.height/3} aria-hidden="true" role="img" width="7.5" height="20" preserveAspectRatio="xMidYMid meet" viewBox="0 0 384 1408"><path d="M384 1120v192q0 40-28 68t-68 28H96q-40 0-68-28t-28-68v-192q0-40 28-68t68-28h192q40 0 68 28t28 68zm0-512v192q0 40-28 68t-68 28H96q-40 0-68-28T0 800V608q0-40 28-68t68-28h192q40 0 68 28t28 68zm0-512v192q0 40-28 68t-68 28H96q-40 0-68-28T0 288V96q0-40 28-68T96 0h192q40 0 68 28t28 68z" fill="#00a2b3"/></svg> */}
                    <g rx="17px" x={node.x + node.width-19} y={node.y + node.height/3 - 10} width="27.5" height="40">
                    <DropDownSvg
                        isMenu={true}
                        y={node.y + node.height}
                        anchor={() => (
                            <g x={node.x + node.width-19} y={node.y + node.height/3 - 10} width="27.5" height="40">
                            <rect className='application-resource-tree__node-menu-button' rx="17px" fill='white' x={node.x + node.width-19} y={node.y + node.height/3 - 10} width="27.5" height="40">
                    
                            </rect>
                            <svg style={{pointerEvents: 'none'}} x={node.x + node.width-9} y={node.y + node.height/3} aria-hidden="true" role="img" width="7.5" height="20" preserveAspectRatio="xMidYMid meet" viewBox="0 0 384 1408"><path d="M384 1120v192q0 40-28 68t-68 28H96q-40 0-68-28t-28-68v-192q0-40 28-68t68-28h192q40 0 68 28t28 68zm0-512v192q0 40-28 68t-68 28H96q-40 0-68-28T0 800V608q0-40 28-68t68-28h192q40 0 68 28t28 68zm0-512v192q0 40-28 68t-68 28H96q-40 0-68-28T0 288V96q0-40 28-68T96 0h192q40 0 68 28t28 68z" fill="#00a2b3"/></svg>
                            </g>
                            )}>
                        {() => props.nodeMenu(node)}
                    </DropDownSvg>
                    </g>
                </g>
            )}
        </g>
        <div>
            {!appNode && <NodeUpdateAnimation resourceVersion={node.resourceVersion} />}
            {/* <div
                className={classNames('application-resource-tree__node-kind-icon', {
                    'application-resource-tree__node-kind-icon--big': rootNode
                })}>
                <ResourceIcon kind={node.kind} />
                <br />
                {!rootNode && <div className='application-resource-tree__node-kind'>{ResourceLabel({kind: node.kind})}</div>}
            </div> */}
            <div className='application-resource-tree__node-content'>
                <span className='application-resource-tree__node-title'>{node.name}</span>
                <br />
                <span
                    className={classNames('application-resource-tree__node-status-icon', {
                        'application-resource-tree__node-status-icon--offset': rootNode
                    })}>
                    {node.hook && <i title='Resource lifecycle hook' className='fa fa-anchor' />}
                    {healthState != null && <HealthStatusIcon state={healthState} />}
                    {comparisonStatus != null && <ComparisonStatusIcon status={comparisonStatus} resource={!rootNode && node} />}
                    {appNode && !rootNode && (
                        <Consumer>
                            {ctx => (
                                <a href={ctx.baseHref + 'applications/' + node.name} title='Open application'>
                                    <i className='fa fa-external-link-alt' />
                                </a>
                            )}
                        </Consumer>
                    )}
                    <ApplicationURLs urls={rootNode ? props.app.status.summary.externalURLs : node.networkingInfo && node.networkingInfo.externalURLs} />
                </span>
            </div>
            <div className='application-resource-tree__node-labels'>
                {node.createdAt || rootNode ? (
                    <Moment className='application-resource-tree__node-label' fromNow={true} ago={true}>
                        {node.createdAt || props.app.metadata.creationTimestamp}
                    </Moment>
                ) : null}
                {(node.info || [])
                    .filter(tag => !tag.name.includes('Node'))
                    .slice(0, 4)
                    .map((tag, i) => (
                        <span className='application-resource-tree__node-label' title={`${tag.name}:${tag.value}`} key={i}>
                            {tag.value}
                        </span>
                    ))}
                {(node.info || []).length > 4 && (
                    <Tooltip
                        content={(node.info || []).map(i => (
                            <div key={i.name}>
                                {i.name}: {i.value}
                            </div>
                        ))}
                        key={node.uid}>
                        <span className='application-resource-tree__node-label' title='More'>
                            More
                        </span>
                    </Tooltip>
                )}
            </div>
            {props.nodeMenu && (
                <div className='application-resource-tree__node-menu'>
                    <DropDown
                        isMenu={true}
                        anchor={() => (
                            <button className='argo-button argo-button--light argo-button--lg argo-button--short'>
                                <i className='fa fa-ellipsis-v' />
                            </button>
                        )}>
                        {() => props.nodeMenu(node)}
                    </DropDown>
                </div>
            )}
        </div>
        </>
    );
}

function renderResourceNode(props: ApplicationResourceTreeProps, id: string, node: ResourceTreeNode & dagre.Node) {
    const fullName = nodeKey(node);
    let comparisonStatus: models.SyncStatusCode = null;
    let healthState: models.HealthStatus = null;
    if (node.status || node.health) {
        comparisonStatus = node.status;
        healthState = node.health;
    }
    const appNode = isAppNode(node);
    const rootNode = !node.root;
    let extLinks: string[] = props.app.status.summary.externalURLs;
    if (rootNode) {
        extLinks = getExternalUrls(props.app.metadata.annotations, props.app.status.summary.externalURLs);
    }
    return (
        <div
            onClick={() => props.onNodeClick && props.onNodeClick(fullName)}
            className={classNames('application-resource-tree__node', {
                'active': fullName === props.selectedNodeFullName,
                'application-resource-tree__node--orphaned': node.orphaned
            })}
            title={describeNode(node)}
            style={{left: node.x, top: node.y, width: node.width, height: node.height}}>
            {!appNode && <NodeUpdateAnimation resourceVersion={node.resourceVersion} />}
            <div
                className={classNames('application-resource-tree__node-kind-icon', {
                    'application-resource-tree__node-kind-icon--big': rootNode
                })}>
                <ResourceIcon kind={node.kind} />
                <br />
                {!rootNode && <div className='application-resource-tree__node-kind'>{ResourceLabel({kind: node.kind})}</div>}
            </div>
            <div className='application-resource-tree__node-content'>
                <span className='application-resource-tree__node-title'>{node.name}</span>
                <br />
                <span
                    className={classNames('application-resource-tree__node-status-icon', {
                        'application-resource-tree__node-status-icon--offset': rootNode
                    })}>
                    {node.hook && <i title='Resource lifecycle hook' className='fa fa-anchor' />}
                    {healthState != null && <HealthStatusIcon state={healthState} />}
                    {comparisonStatus != null && <ComparisonStatusIcon status={comparisonStatus} resource={!rootNode && node} />}
                    {appNode && !rootNode && (
                        <Consumer>
                            {ctx => (
                                <a href={ctx.baseHref + 'applications/' + node.name} title='Open application'>
                                    <i className='fa fa-external-link-alt' />
                                </a>
                            )}
                        </Consumer>
                    )}
                    <ApplicationURLs urls={rootNode ? extLinks : node.networkingInfo && node.networkingInfo.externalURLs} />
                </span>
            </div>
            <div className='application-resource-tree__node-labels'>
                {node.createdAt || rootNode ? (
                    <Moment className='application-resource-tree__node-label' fromNow={true} ago={true}>
                        {node.createdAt || props.app.metadata.creationTimestamp}
                    </Moment>
                ) : null}
                {(node.info || [])
                    .filter(tag => !tag.name.includes('Node'))
                    .slice(0, 4)
                    .map((tag, i) => (
                        <span className='application-resource-tree__node-label' title={`${tag.name}:${tag.value}`} key={i}>
                            {tag.value}
                        </span>
                    ))}
                {(node.info || []).length > 4 && (
                    <Tooltip
                        content={(node.info || []).map(i => (
                            <div key={i.name}>
                                {i.name}: {i.value}
                            </div>
                        ))}
                        key={node.uid}>
                        <span className='application-resource-tree__node-label' title='More'>
                            More
                        </span>
                    </Tooltip>
                )}
            </div>
            {props.nodeMenu && (
                <div className='application-resource-tree__node-menu'>
                    <DropDown
                        isMenu={true}
                        anchor={() => (
                            <button className='argo-button argo-button--light argo-button--lg argo-button--short'>
                                <i className='fa fa-ellipsis-v' />
                            </button>
                        )}>
                        {() => props.nodeMenu(node)}
                    </DropDown>
                </div>
            )}
        </div>
    );
}

function findNetworkTargets(nodes: ResourceTreeNode[], networkingInfo: models.ResourceNetworkingInfo, props: ApplicationResourceTreeProps): ResourceTreeNode[] {
    let result = new Array<ResourceTreeNode>();
    const refs = new Set((networkingInfo.targetRefs || []).map(nodeKey));
    result = result.concat(nodes.filter(target => refs.has(nodeKey(target))));
    if (networkingInfo.targetLabels) {
        result = result.concat(
            nodes.filter(target => {
                if (target.networkingInfo && target.networkingInfo.labels) {
                    return Object.keys(networkingInfo.targetLabels).every(key => networkingInfo.targetLabels[key] === target.networkingInfo.labels[key]);
                }
                return false;
            })
        );
    }
    return result;
}
export const ApplicationResourceTree = (props: ApplicationResourceTreeProps) => {
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({nodesep: 15, rankdir: 'LR', marginx: -100});
    graph.setDefaultEdgeLabel(() => ({}));
    const overridesCount = getAppOverridesCount(props.app);
    const appNode = {
        kind: props.app.kind,
        name: props.app.metadata.name,
        namespace: props.app.metadata.namespace,
        resourceVersion: props.app.metadata.resourceVersion,
        group: 'argoproj.io',
        version: '',
        children: Array(),
        status: props.app.status.sync.status,
        health: props.app.status.health,
        info:
            overridesCount > 0
                ? [
                      {
                          name: 'Parameter overrides',
                          value: `${overridesCount} parameter override(s)`
                      }
                  ]
                : []
    };

    const statusByKey = new Map<string, models.ResourceStatus>();
    props.app.status.resources.forEach(res => statusByKey.set(nodeKey(res), res));
    const nodeByKey = new Map<string, ResourceTreeNode>();
    props.tree.nodes
        .map(node => ({...node, orphaned: false}))
        .concat(((props.showOrphanedResources && props.tree.orphanedNodes) || []).map(node => ({...node, orphaned: true})))
        .forEach(node => {
            const status = statusByKey.get(nodeKey(node));
            const resourceNode: ResourceTreeNode = {...node};
            if (status) {
                resourceNode.health = status.health;
                resourceNode.status = status.status;
                resourceNode.hook = status.hook;
                resourceNode.requiresPruning = status.requiresPruning;
            }
            nodeByKey.set(treeNodeKey(node), resourceNode);
        });
    const nodes = Array.from(nodeByKey.values());
    let roots: ResourceTreeNode[] = [];
    const childrenByParentKey = new Map<string, ResourceTreeNode[]>();

    if (props.useNetworkingHierarchy) {
        // Network view
        const hasParents = new Set<string>();
        const networkNodes = nodes.filter(node => node.networkingInfo);
        const hiddenNodes: ResourceTreeNode[] = [];
        // const managedKeys = new Set(props.app.status.resources.map(nodeKey));
        networkNodes.forEach(parent => {
            findNetworkTargets(networkNodes, parent.networkingInfo, props).forEach(child => {
                const children = childrenByParentKey.get(treeNodeKey(parent)) || [];
                if (props.getNodeExpansion(parent.kind + ":" + parent.name)) {   
                    hasParents.add(treeNodeKey(child));
                    children.push(child);
                    childrenByParentKey.set(treeNodeKey(parent), children);
                } else {
                    hiddenNodes.push(child);
                }
            });
        });

        // nodes.forEach(node => {
        //     if ((node.parentRefs || []).length === 0 || managedKeys.has(nodeKey(node))) {
        //         roots.push(node);
        //     } else {
        //         node.parentRefs.forEach(parent => {                    
        //             const children = childrenByParentKey.get(treeNodeKey(parent)) || [];
        //             if (props.getNodeExpansion(parent.kind + ":" + parent.name)) {                    
        //                 children.push(node);
        //                 childrenByParentKey.set(treeNodeKey(parent), children);
        //             }
        //         });
        //     }
        // });
        roots = networkNodes.filter(node => !hasParents.has(treeNodeKey(node)));
        roots = roots.reduce((acc, curr) => {
            if (hiddenNodes.indexOf(curr) < 0) {
                acc.push(curr);
            }
            return acc;
        }, [])
        const externalRoots = roots.filter(root => (root.networkingInfo.ingress || []).length > 0).sort(compareNodes);
        const internalRoots = roots.filter(root => (root.networkingInfo.ingress || []).length === 0).sort(compareNodes);
        const colorsBySource = new Map<string, string>();
        // sources are root internal services and external ingress/service IPs
        const sources = Array.from(
            new Set(
                internalRoots
                    .map(root => treeNodeKey(root))
                    .concat(
                        externalRoots.map(root => root.networkingInfo.ingress.map(ingress => ingress.hostname || ingress.ip)).reduce((first, second) => first.concat(second), [])
                    )
            )
        );
        // assign unique color to each traffic source
        sources.forEach((key, i) => colorsBySource.set(key, TRAFFIC_COLORS[i % TRAFFIC_COLORS.length]));

        if (externalRoots.length > 0) {
            graph.setNode(EXTERNAL_TRAFFIC_NODE, {height: NODE_HEIGHT, width: 30, type: NODE_TYPES.externalTraffic});
            externalRoots.sort(compareNodes).forEach(root => {
                const loadBalancers = root.networkingInfo.ingress.map(ingress => ingress.hostname || ingress.ip);
                const colorByService = new Map<string, string>();
                (childrenByParentKey.get(treeNodeKey(root)) || []).forEach((child, i) => colorByService.set(treeNodeKey(child), TRAFFIC_COLORS[i % TRAFFIC_COLORS.length]));
                (childrenByParentKey.get(treeNodeKey(root)) || []).sort(compareNodes).forEach((child, i) => {
                    processNode(child, root, [colorByService.get(treeNodeKey(child))]);
                });
                graph.setNode(treeNodeKey(root), {...root, width: NODE_WIDTH, height: NODE_HEIGHT, root});
                (childrenByParentKey.get(treeNodeKey(root)) || []).forEach(child => {
                    if (root.namespace === child.namespace) {
                        graph.setEdge(treeNodeKey(root), treeNodeKey(child), {colors: [colorByService.get(treeNodeKey(child))]});
                    }
                });
                loadBalancers.forEach(key => {
                    const loadBalancerNodeKey = `${EXTERNAL_TRAFFIC_NODE}:${key}`;
                    graph.setNode(loadBalancerNodeKey, {
                        height: NODE_HEIGHT,
                        width: NODE_WIDTH,
                        type: NODE_TYPES.externalLoadBalancer,
                        label: key,
                        color: colorsBySource.get(key)
                    });
                    graph.setEdge(loadBalancerNodeKey, treeNodeKey(root), {colors: [colorsBySource.get(key)]});
                    graph.setEdge(EXTERNAL_TRAFFIC_NODE, loadBalancerNodeKey, {colors: [colorsBySource.get(key)]});
                });
            });
        }

        if (internalRoots.length > 0) {
            graph.setNode(INTERNAL_TRAFFIC_NODE, {height: NODE_HEIGHT, width: 30, type: NODE_TYPES.internalTraffic});
            internalRoots.forEach(root => {
                processNode(root, root, [colorsBySource.get(treeNodeKey(root))]);
                graph.setEdge(INTERNAL_TRAFFIC_NODE, treeNodeKey(root));
            });
        }
        if (props.nodeFilter) {
            // show filtered indicator next to external traffic node is app has it otherwise next to internal traffic node
            filterGraph(props.app, externalRoots.length > 0 ? EXTERNAL_TRAFFIC_NODE : INTERNAL_TRAFFIC_NODE, graph, props.nodeFilter);
        }
    } else {
        // Tree view
        const managedKeys = new Set(props.app.status.resources.map(nodeKey));
        const orphanedKeys = new Set(props.tree.orphanedNodes?.map(nodeKey));
        const orphans: ResourceTreeNode[] = [];
        nodes.forEach(node => {
            if ((node.parentRefs || []).length === 0 || managedKeys.has(nodeKey(node))) {
                roots.push(node);
            } else {
                if (orphanedKeys.has(nodeKey(node))) {
                    orphans.push(node);
                }
                node.parentRefs.forEach(parent => {                    
                    const children = childrenByParentKey.get(treeNodeKey(parent)) || [];
                    if (props.getNodeExpansion(parent.kind + ":" + parent.name)) {                    
                        children.push(node);
                        childrenByParentKey.set(treeNodeKey(parent), children);
                    }
                });
            }
        });
        roots.sort(compareNodes).forEach(node => {
            processNode(node, node);
            graph.setEdge(appNodeKey(props.app), treeNodeKey(node));
        });
        orphans.sort(compareNodes).forEach(node => {
            processNode(node, node);
        });
        graph.setNode(appNodeKey(props.app), {...appNode, width: NODE_WIDTH, height: NODE_HEIGHT});
        if (props.nodeFilter) {
            filterGraph(props.app, appNodeKey(props.app), graph, props.nodeFilter);
        }
        if (props.showCompactNodes) {
            groupNodes(nodes, graph);
        }
    }

    function processNode(node: ResourceTreeNode, root: ResourceTreeNode, colors?: string[]) {
        graph.setNode(treeNodeKey(node), {...node, width: NODE_WIDTH, height: NODE_HEIGHT, root});
        (childrenByParentKey.get(treeNodeKey(node)) || []).sort(compareNodes).forEach(child => {
            if (treeNodeKey(child) === treeNodeKey(root)) {
                return;
            }
            if (node.namespace === child.namespace) {
                graph.setEdge(treeNodeKey(node), treeNodeKey(child), {colors});
            }
            processNode(child, root, colors);
        });
    }
    dagre.layout(graph);

    const edges: {from: string; to: string; lines: Line[]; backgroundImage?: string}[] = [];
    graph.edges().forEach(edgeInfo => {
        const edge = graph.edge(edgeInfo);
        const colors = (edge.colors as string[]) || [];
        let backgroundImage: string;
        if (colors.length > 0) {
            const step = 100 / colors.length;
            const gradient = colors.map((lineColor, i) => {
                return `${lineColor} ${step * i}%, ${lineColor} ${step * i + step / 2}%, transparent ${step * i + step / 2}%, transparent ${step * (i + 1)}%`;
            });
            backgroundImage = `linear-gradient(90deg, ${gradient})`;
        }

        const lines: Line[] = [];
        // don't render connections from hidden node representing internal traffic
        if (edgeInfo.v === INTERNAL_TRAFFIC_NODE || edgeInfo.w === INTERNAL_TRAFFIC_NODE) {
            return;
        }
        if (edge.points.length > 1) {
            for (let i = 1; i < edge.points.length; i++) {
                lines.push({x1: edge.points[i - 1].x, y1: edge.points[i - 1].y, x2: edge.points[i].x, y2: edge.points[i].y});
            }
        }
        edges.push({from: edgeInfo.v, to: edgeInfo.w, lines, backgroundImage});
    });
    const graphNodes = graph.nodes();
    const size = getGraphSize(graphNodes.map(id => graph.node(id)));

        let zoom = 1.0;
    function getViewPort(size: any, zoom: number) {
        return "0 0 " + (size.width + 150) * zoom + " " + (size.height + 250) * zoom;
    }

    // const slider = document.getElementById("zoomRange");
    const svgZoom = document.getElementById("svgZoom");
    // const mainDiv = document.getElementById("mainDiv");
    const origDiv = document.getElementById("originalTreeView");
    const zoomValue = document.getElementById("zoomValue");
    function setViewPort(size: any, zoom: number) {
        svgZoom.setAttribute('viewBox', getViewPort(size, zoom))
    }
    let extra = 1000;
    const handleChange = (value: string) => {
        zoomValue.innerText = `${value}%`;
        const num = parseInt(value);
        svgZoom.style.transform = `scale( ${num} / 100)`;
        zoom = num / 100;
        setViewPort(size, zoom);
        origDiv.style.transform = `scale(${num / 100})`;
        // if (zoom < 1) {
        //     extra = 200 / zoom;
            // mainDiv.setAttribute('style', 'width=' + size.width + 150 + extra);
        // }
    };

    return (
        (graphNodes.length === 0 && (
            <EmptyState icon=' fa fa-network-wired'>
                <h4>Your application has no network resources</h4>
                <h5>Try switching to tree or list view</h5>
            </EmptyState>
        )) || (
            <>
            <input style={{marginLeft: '200px'}} type="range" min="1" max="200" defaultValue='100' className="slider" id="zoomRange" onChange={(e)=> handleChange(e.target.value)}/>
            <span id="zoomValue">100%</span>
            <div id="mainDiv"


                style={{alignContent:'flex-start', width: (size.width + 150 + extra), height: (size.height + 250)}}>
                
                {/* <svg viewBox={getViewPort(size)} xmlns="http://www.w3.org/2000/svg"> */}
                <svg id="svgZoom" height={size.height + 250} width={size.width + 15 + extra} xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMinYMin meet">
                {graphNodes.map(key => {
                    const node = graph.node(key);
                    const nodeType = node.type;
                    switch (nodeType) {
                        case NODE_TYPES.filteredIndicator:
                            return <React.Fragment key={key}>{renderFilteredNode(node as any, props.onClearFilter)}</React.Fragment>;
                        case NODE_TYPES.externalTraffic:
                            return <React.Fragment key={key}>{renderTrafficNode(node)}</React.Fragment>;
                        case NODE_TYPES.internalTraffic:
                            return null;
                        case NODE_TYPES.externalLoadBalancer:
                            return <React.Fragment key={key}>{renderLoadBalancerNode(node as any)}</React.Fragment>;
                        case NODE_TYPES.groupedNodes:
                            return <React.Fragment key={key}>{renderGroupedNodes(props, node as any)}</React.Fragment>;
                        default:
                            return <React.Fragment key={key}>{renderResourceNodeSVG(props, key, node as ResourceTreeNode & dagre.Node)}</React.Fragment>;
                    }
                })}
                {/* </svg> */}
                {/* <circle fill="green" cx={size.width} cy={size.height} r="15"/> */}
                {edges.map(edge => (
                    <g key={`${edge.from}-${edge.to}`} className='application-resource-tree__edge'>
                        {edge.lines.map((line, i) => {
                            const distance = Math.sqrt(Math.pow(line.x1 - line.x2, 2) + Math.pow(line.y1 - line.y2, 2));
                            const xMid = (line.x1 + line.x2) / 2;
                            const yMid = (line.y1 + line.y2) / 2;
                            const angle = (Math.atan2(line.y1 - line.y2, line.x1 - line.x2) * 180) / Math.PI;
                            return (
                                <line 
                                    // className='application-resource-tree__line'
                                    // key={i}
                                    // transform={`translate(150px, 35px) rotate(${angle}deg)`}
                                    x1={line.x1 + 150}
                                    y1={line.y1 + 26}
                                    x2={line.x2 + 150}
                                    y2={line.y2 + 26}
                                    stroke='gray'
                                    strokeDasharray={1}
                                    style={{
                                        zIndex: -1,
                                        borderTop: '1px dashed $argo-color-gray-5'
                                        // width: distance,
                                        // left: xMid - distance / 2,
                                        // top: yMid,
                                        // backgroundImage: edge.backgroundImage,
                                        // transform: `translate(150px, 35px) rotate(${angle}deg)`
                                    }}
                                />
                            );
                        })}
                    </g>
                ))}
                </svg>
            </div>
            <div id="originalTreeView"
                className={classNames('application-resource-tree', {'application-resource-tree--network': props.useNetworkingHierarchy})}
                style={{width: size.width + 150, height: size.height + 250, transformOrigin: '0% 0%', transform: `scale(${props.zoom})`}}>
                {graphNodes.map(key => {
                    const node = graph.node(key);
                    const nodeType = node.type;
                    switch (nodeType) {
                        case NODE_TYPES.filteredIndicator:
                            return <React.Fragment key={key}>{renderFilteredNode(node as any, props.onClearFilter)}</React.Fragment>;
                        case NODE_TYPES.externalTraffic:
                            return <React.Fragment key={key}>{renderTrafficNode(node)}</React.Fragment>;
                        case NODE_TYPES.internalTraffic:
                            return null;
                        case NODE_TYPES.externalLoadBalancer:
                            return <React.Fragment key={key}>{renderLoadBalancerNode(node as any)}</React.Fragment>;
                        case NODE_TYPES.groupedNodes:
                            return <React.Fragment key={key}>{renderGroupedNodes(props, node as any)}</React.Fragment>;
                        default:
                            return <React.Fragment key={key}>{renderResourceNode(props, key, node as ResourceTreeNode & dagre.Node)}</React.Fragment>;
                    }
                })}
                {edges.map(edge => (
                    <div key={`${edge.from}-${edge.to}`} className='application-resource-tree__edge'>
                        {edge.lines.map((line, i) => {
                            const distance = Math.sqrt(Math.pow(line.x1 - line.x2, 2) + Math.pow(line.y1 - line.y2, 2));
                            const xMid = (line.x1 + line.x2) / 2;
                            const yMid = (line.y1 + line.y2) / 2;
                            const angle = (Math.atan2(line.y1 - line.y2, line.x1 - line.x2) * 180) / Math.PI;
                            return (
                                <div
                                    className='application-resource-tree__line'
                                    key={i}
                                    style={{
                                        width: distance,
                                        left: xMid - distance / 2,
                                        top: yMid,
                                        backgroundImage: edge.backgroundImage,
                                        transform: `translate(150px, 35px) rotate(${angle}deg)`
                                    }}
                                />
                            );
                        })}
                    </div>
                ))}
            </div>
            </>
        )
    );
};
