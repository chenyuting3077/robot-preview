/**
 * ModelGraphView - D3.js model structure graph view
 * Responsible for drawing and managing model tree structure graph
 */
import * as d3 from '../d3-lite.js';

export class ModelGraphView {
    constructor(sceneManager, measurementController = null) {
        this.sceneManager = sceneManager;
        this.measurementController = measurementController;
        this.onReveal = null;
        this.currentZoom = null; // Save current zoom behavior
        this.currentSvg = null; // Save current SVG selector
        this.currentContainer = null; // Save current container

        const svgNode = document.getElementById('model-graph-svg');
        if (svgNode) {
            let wasVisible = false;
            new ResizeObserver(([entry]) => {
                const visible = entry.contentRect.width > 0 && entry.contentRect.height > 0;
                if (visible && !wasVisible) this.fitToView(false);
                wasVisible = visible;
            }).observe(svgNode);
        }
    }

    /**
     * Draw model structure graph
     */
    drawModelGraph(model, { keepView = false } = {}) {
        const svg = d3.select('#model-graph-svg');
        const emptyState = document.getElementById('graph-empty-state');
        const previousTransform = keepView && svg.node() ? d3.zoomTransform(svg.node()) : null;

        svg.selectAll('*:not(defs)').remove();

        if (!model || !model.links || model.links.size === 0) {
            emptyState?.classList.remove('hidden');
            return;
        }

        emptyState?.classList.add('hidden');

        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const isLightTheme = currentTheme === 'light';

        const nodeColors = isLightTheme ? {
            bg: 'rgba(240, 240, 245, 0.95)',
            stroke: 'rgba(0, 0, 0, 0.15)',
            text: '#1a1a1a'
        } : {
            bg: 'rgba(42, 42, 46, 0.95)',
            stroke: 'rgba(255, 255, 255, 0.12)',
            text: '#e0e0e0'
        };

        const treeData = this.buildHierarchy(model.rootLink, model);
        if (!treeData) {
            emptyState?.classList.remove('hidden');
            return;
        }

        // getBBox reads 0 while the panel is hidden, which is when the graph
        // is usually drawn, so text is measured on a canvas instead.
        const measureContext = document.createElement('canvas').getContext('2d');
        const fontFamily = getComputedStyle(svg.node()).fontFamily;
        const textWidth = (text, size, weight) => {
            measureContext.font = `${weight} ${size}px ${fontFamily}`;
            return measureContext.measureText(text).width;
        };
        const LINK_PAD_X = 28;
        const JOINT_PAD_X = 16;
        const NODE_GAP = 24;

        const hierarchy = d3.hierarchy(treeData);
        hierarchy.each(d => {
            const linkWidth = textWidth(d.data.name, 18, 500) + LINK_PAD_X * 2;
            const jointWidth = d.data.jointName
                ? Math.max(textWidth(d.data.jointName, 12, 500), textWidth(d.data.jointType || 'joint', 10, 400)) + JOINT_PAD_X * 2
                : 0;
            d.width = Math.max(linkWidth, jointWidth);
        });

        // Siblings sit apart by their own label widths, so a link with many
        // children (fixed sensors on base_link) keeps every label readable.
        d3.tree()
            .nodeSize([1, 120])
            .separation((a, b) => (a.width + b.width) / 2 + NODE_GAP)(hierarchy);

        const container = svg.append('g').attr('class', 'zoom-container');

        const zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                container.attr('transform', event.transform);
            });

        svg.call(zoom);

        // Save references for later use
        this.currentZoom = zoom;
        this.currentSvg = svg;
        this.currentContainer = container;

        // Record mouse down position to distinguish click from drag
        let mouseDownPos = null;
        let mouseDownTime = 0;

        svg.on('mousedown', function(event) {
            mouseDownPos = { x: event.clientX, y: event.clientY };
            mouseDownTime = Date.now();
        });

        // Click SVG blank area to clear selection and measurement
        svg.on('mouseup', (event) => {
            if (!mouseDownPos) return;

            const dx = event.clientX - mouseDownPos.x;
            const dy = event.clientY - mouseDownPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const duration = Date.now() - mouseDownTime;

            // If movement distance less than 5 pixels and duration less than 300ms, consider it a click
            if (distance < 5 && duration < 300) {
                const target = event.target;
                const tagName = target.tagName.toLowerCase();

                if (tagName === 'svg' || target === svg.node() ||
                    (tagName === 'g' && target.classList?.contains('zoom-container'))) {
                    this.clearAllSelections(svg);

                    if (this.measurementController) {
                        this.measurementController.clearMeasurement();
                    }

                    if (this.sceneManager) {
                        this.sceneManager.highlightManager.clearHighlight();
                    }
                }
            }

            mouseDownPos = null;
        });

        // Add click handler for container (handle blank area clicks within container)
        container.on('click', (event) => {
            const target = event.target;
            const tagName = target.tagName.toLowerCase();

            // Check if clicked area is blank
            const isBlankArea = (
                (tagName === 'g' && (
                    target.classList?.contains('zoom-container') ||
                    target.classList?.contains('links') ||
                    target.classList?.contains('joint-labels') ||
                    target.classList?.contains('nodes')
                )) ||
                (tagName === 'path' && target.classList?.contains('graph-link'))
            );

            if (isBlankArea) {
                this.clearAllSelections(svg);

                if (this.measurementController) {
                    this.measurementController.clearMeasurement();
                }

                if (this.sceneManager) {
                    this.sceneManager.highlightManager.clearHighlight();
                }
            }
        });

        // Add document-level click listener
        this.setupDocumentClickHandler();

        // Draw connection lines
        const linkGroup = container.append('g').attr('class', 'links');
        linkGroup.selectAll('path')
            .data(hierarchy.links())
            .enter()
            .append('path')
            .attr('class', 'graph-link')
            // Curves to the joint label above the child, then drops straight:
            // labels at the curve midpoints would crowd under a wide parent.
            .attr('d', d => {
                const sx = d.source.x + 50, sy = d.source.y + 50;
                const tx = d.target.x + 50, ty = d.target.y + 50;
                const my = (sy + ty) / 2;
                return `M${sx},${sy}C${sx},${(sy + my) / 2} ${tx},${(sy + my) / 2} ${tx},${my}L${tx},${ty}`;
            });

        // Draw joint nodes (on connection lines)
        const jointGroup = container.append('g').attr('class', 'joint-nodes');
        const joints = jointGroup.selectAll('g')
            .data(hierarchy.links().filter(link => link.target.data.jointName))
            .enter()
            .append('g')
            .attr('class', 'graph-joint-group')
            .attr('transform', d => {
                // Above the child, halfway down from the parent
                const midX = d.target.x + 50;
                const midY = (d.source.y + d.target.y) / 2 + 50;
                return `translate(${midX}, ${midY})`;
            })
            .style('cursor', 'pointer');

        // Add two lines of text: first line is joint name, second line is joint type
        joints.each(function(d) {
            const jointGroup = d3.select(this);

            // First line: joint name
            const nameText = jointGroup.append('text')
                .attr('class', 'joint-name-text')
                .attr('dy', -4)
                .attr('text-anchor', 'middle')
                .style('font-size', '12px')
                .style('font-weight', '500')
                .style('fill', nodeColors.text)
                .style('user-select', 'none')
                .text(d.target.data.jointName);

            // Second line: joint type
            const typeText = jointGroup.append('text')
                .attr('class', 'joint-type-text')
                .attr('dy', 10)
                .attr('text-anchor', 'middle')
                .style('font-size', '10px')
                .style('font-weight', '400')
                .style('fill', nodeColors.text)
                .style('opacity', 0.7)
                .style('user-select', 'none')
                .text(d.target.data.jointType || 'joint');

            const maxTextWidth = Math.max(
                textWidth(d.target.data.jointName, 12, 500),
                textWidth(d.target.data.jointType || 'joint', 10, 400)
            );

            const paddingX = JOINT_PAD_X;
            const paddingY = 8;  // Top-bottom padding
            const lineHeight = 14; // Line height
            const capsuleWidth = maxTextWidth + paddingX * 2;
            const capsuleHeight = paddingY * 2 + lineHeight * 2; // Height of two lines
            const radius = capsuleHeight / 2; // Capsule shape: use half of height as radius

            // Insert capsule background (fully rounded capsule shape)
            jointGroup.insert('rect', 'text')
                .attr('class', 'joint-capsule-bg')
                .attr('x', -capsuleWidth / 2)
                .attr('y', -capsuleHeight / 2)
                .attr('width', capsuleWidth)
                .attr('height', capsuleHeight)
                .attr('rx', radius) // Use half of height as corner radius to form capsule shape
                .style('fill', nodeColors.bg)
                .style('stroke', nodeColors.stroke)
                .style('stroke-width', '1.5');

            // Insert border (for highlight effect)
            jointGroup.insert('rect', '.joint-capsule-bg')
                .attr('class', 'joint-capsule-border')
                .attr('x', -capsuleWidth / 2 - 2)
                .attr('y', -capsuleHeight / 2 - 2)
                .attr('width', capsuleWidth + 4)
                .attr('height', capsuleHeight + 4)
                .attr('rx', radius + 2) // Border also uses capsule shape
                .style('fill', 'none')
                .style('stroke', 'transparent')
                .style('stroke-width', '2');
        });

        // Joint click event
        joints.on('click', (event, d) => {
            event.stopPropagation();

            if (!d.target.data.jointName) return;

            // Get joint object from model
            const joint = model.joints.get(d.target.data.jointName);
            if (!joint) return;

            // Check if Ctrl key is pressed (measurement mode)
            if (event.ctrlKey || event.metaKey) {
                if (this.measurementController) {
                    this.measurementController.handleSelection(joint, event.currentTarget, 'joint');
                }
            } else {
                // Normal click: highlight joint + jump to code
                if (this.measurementController) {
                    this.measurementController.clearMeasurement();
                }

                // Clear all selection states
                this.clearAllSelections(svg);

                // Select current joint node
                d3.select(event.currentTarget).classed('selected', true);
                d3.select(event.currentTarget).select('.joint-capsule-border')
                    .style('stroke', isLightTheme ? 'var(--accent)' : '#ff4a4a')
                    .style('stroke-width', '3');
                d3.select(event.currentTarget).select('.joint-capsule-bg')
                    .style('fill', isLightTheme ? 'rgba(10, 132, 255, 0.15)' : '#3a3a3a');

                if (this.sceneManager) {
                    this.sceneManager.highlightManager.clearHighlight();
                    this.sceneManager.axesManager.showOnlyJointAxis(joint);
                }

                // Jump to joint definition in code editor
                if (d.target.data.jointName) {
                    this.onReveal?.('joint', d.target.data.jointName);
                }
            }
        });

        // Joint hover effect
        joints.on('mouseenter', function() {
            const currentGroup = d3.select(this);
            if (!currentGroup.classed('selected')) {
                currentGroup.select('.joint-capsule-bg')
                    .transition()
                    .duration(200)
                    .style('opacity', 0.8);
            }
        }).on('mouseleave', function() {
            const currentGroup = d3.select(this);
            if (!currentGroup.classed('selected')) {
                currentGroup.select('.joint-capsule-bg')
                    .transition()
                    .duration(200)
                    .style('opacity', 1);
            }
        });

        // Add tooltip
        joints.append('title')
            .text(d => `${d.target.data.jointName} (${d.target.data.jointType || 'joint'})`);

        // Draw nodes
        const nodeGroup = container.append('g').attr('class', 'nodes');
        const node = nodeGroup.selectAll('g')
            .data(hierarchy.descendants())
            .enter()
            .append('g')
            .attr('class', 'graph-node')
            .attr('transform', d => `translate(${d.x + 50}, ${d.y + 50})`)
            .style('cursor', 'pointer');

        const textElements = node.append('text')
            .attr('dy', 6)
            .attr('text-anchor', 'middle')
            .style('font-size', '18px')
            .style('font-weight', '500')
            .style('fill', nodeColors.text)
            .style('user-select', 'none')
            .text(d => d.data.name);

        // 22px: the line box of 18px text, what getBBox gives when visible.
        node.each(function(d) {
            const nodeGroup = d3.select(this);
            const paddingY = 10;
            const boxWidth = textWidth(d.data.name, 18, 500) + LINK_PAD_X * 2;
            const boxHeight = 22 + paddingY * 2 + 8;

            nodeGroup.insert('rect', 'text')
                .attr('class', 'node-bg')
                .attr('x', -boxWidth / 2)
                .attr('y', -boxHeight / 2)
                .attr('width', boxWidth)
                .attr('height', boxHeight)
                .attr('rx', 12)
                .style('fill', nodeColors.bg)
                .style('stroke', nodeColors.stroke)
                .style('stroke-width', '1.5');

            nodeGroup.insert('rect', '.node-bg')
                .attr('class', 'node-border')
                .attr('x', -boxWidth / 2 - 2)
                .attr('y', -boxHeight / 2 - 2)
                .attr('width', boxWidth + 4)
                .attr('height', boxHeight + 4)
                .attr('rx', 14)
                .style('fill', 'none')
                .style('stroke', 'transparent')
                .style('stroke-width', '3');
        });

        node.on('click', (event, d) => {
            event.stopPropagation();

            // Check if Ctrl key is pressed (measurement mode)
            if (event.ctrlKey || event.metaKey) {
                if (d.data.data && this.measurementController) {
                    this.measurementController.handleSelection(d.data.data, event.currentTarget, 'link');
                }
            } else {
                // Normal click: highlight Link + jump to code
                if (this.measurementController) {
                    this.measurementController.clearMeasurement();
                }

                // Clear all selection states (including style reset)
                this.clearAllSelections(svg);

                // Select current node
                d3.select(event.currentTarget).classed('selected', true);
                d3.select(event.currentTarget).select('.node-border')
                    .style('stroke', isLightTheme ? 'var(--accent)' : '#4a9eff')
                    .style('stroke-width', '6');
                d3.select(event.currentTarget).select('.node-bg')
                    .style('fill', isLightTheme ? 'rgba(10, 132, 255, 0.15)' : '#3a3a3a');

                if (d.data.data && this.sceneManager) {
                    this.sceneManager.highlightManager.clearHighlight();
                    this.sceneManager.highlightManager.highlightLink(d.data.data, this.sceneManager.currentModel);
                }

                // Jump to link definition in code editor
                if (d.data.name) {
                    this.onReveal?.('link', d.data.name);
                }
            }
        });

        // Right-click: toggle link visibility
        node.on('contextmenu', (event, d) => {
            event.preventDefault();
            event.stopPropagation();

            if (!this.sceneManager || !d.data.data) return;

            const linkName = d.data.name;
            const isVisible = this.sceneManager.visualizationManager.toggleLinkVisibility(linkName, this.sceneManager.currentModel);

            const nodeElement = d3.select(event.currentTarget);
            if (!isVisible) {
                nodeElement.classed('hidden', true);
                nodeElement.select('.node-bg')
                    .style('fill', isLightTheme ? 'rgba(0, 0, 0, 0.1)' : '#1a1a1a')
                    .style('opacity', '0.5');
                nodeElement.select('text')
                    .style('fill', isLightTheme ? '#999' : '#666')
                    .style('opacity', '0.6');
            } else {
                nodeElement.classed('hidden', false);
                nodeElement.select('.node-bg')
                    .style('fill', nodeColors.bg)
                    .style('opacity', '1');
                nodeElement.select('text')
                    .style('fill', nodeColors.text)
                    .style('opacity', '1');
            }
        });

        // Add ground node (placed above root node)
        const rootNode = hierarchy.descendants()[0];
        const groundX = rootNode.x + 50; // Use root node's x coordinate
        const groundY = rootNode.y + 50 - 80; // 80px above root node

        const groundNode = container.append('g')
            .attr('class', 'graph-node ground-node')
            .attr('transform', `translate(${groundX}, ${groundY})`)
            .style('cursor', 'pointer');

        // Add text first
        const groundText = groundNode.append('text')
            .attr('dy', 6)
            .attr('text-anchor', 'middle')
            .style('font-size', '18px')
            .style('font-weight', '500')
            .style('fill', nodeColors.text)
            .style('user-select', 'none')
            .text('Ground');

        // Dynamically adjust ground node rectangle size based on text width - Apple style
        const groundPaddingY = 10; // Consistent with other nodes
        const groundBoxWidth = textWidth('Ground', 18, 500) + LINK_PAD_X * 2;
        const groundBoxHeight = 22 + groundPaddingY * 2 + 8;

        groundNode.insert('rect', 'text')
            .attr('class', 'node-bg')
            .attr('x', -groundBoxWidth / 2)
            .attr('y', -groundBoxHeight / 2)
            .attr('width', groundBoxWidth)
            .attr('height', groundBoxHeight)
            .attr('rx', 12)
            .style('fill', nodeColors.bg)
            .style('stroke', nodeColors.stroke)
            .style('stroke-width', '1.5');

        groundNode.insert('rect', '.node-bg')
            .attr('class', 'node-border')
            .attr('x', -groundBoxWidth / 2 - 2)
            .attr('y', -groundBoxHeight / 2 - 2)
            .attr('width', groundBoxWidth + 4)
            .attr('height', groundBoxHeight + 4)
            .attr('rx', 14)
            .style('fill', 'none')
            .style('stroke', 'transparent')
            .style('stroke-width', '3');

        groundNode.append('title')
            .text('Ground');

        // Ground node click event
        groundNode.on('click', (event) => {
            event.stopPropagation();

            // Check if Ctrl key is pressed
            if (event.ctrlKey || event.metaKey) {
                // Ctrl+click: measurement mode
                if (this.measurementController) {
                    this.measurementController.handleSelection({ name: 'ground' }, event.currentTarget, 'link');
                }
            } else {
                // Normal click: only clear measurement state
                if (this.measurementController) {
                    this.measurementController.clearMeasurement();
                }

                // Clear all selection states
                this.clearAllSelections(svg);

                // Select ground node
                d3.select(event.currentTarget).classed('selected', true);
                d3.select(event.currentTarget).select('.node-border')
                    .style('stroke', '#4a9eff')
                    .style('stroke-width', '6');
                d3.select(event.currentTarget).select('.node-bg')
                    .style('fill', '#3a3a3a');
            }
        });

        // Draw parallel mechanism constraints (closed-chain connections)
        if (model.constraints && model.constraints.size > 0) {
            const constraintGroup = container.append('g').attr('class', 'constraints');

            model.constraints.forEach((constraint, name) => {
                if (constraint.type === 'connect' || constraint.type === 'weld') {
                    // Find positions of two bodies in tree
                    const body1Node = hierarchy.descendants().find(d => d.data.name === constraint.body1);
                    const body2Node = hierarchy.descendants().find(d => d.data.name === constraint.body2);

                    if (body1Node && body2Node) {
                        // Draw dashed line connection
                        const x1 = body1Node.x + 50;
                        const y1 = body1Node.y + 50;
                        const x2 = body2Node.x + 50;
                        const y2 = body2Node.y + 50;

                        const color = constraint.type === 'weld' ? '#ff6600' : '#00ffff';

                        constraintGroup.append('line')
                            .attr('x1', x1)
                            .attr('y1', y1)
                            .attr('x2', x2)
                            .attr('y2', y2)
                            .style('stroke', color)
                            .style('stroke-width', '2')
                            .style('stroke-dasharray', '5,5')
                            .style('opacity', '0.6')
                            .append('title')
                            .text(`${constraint.type}: ${constraint.body1} ↔ ${constraint.body2}`);
                    }
                } else if (constraint.type === 'joint') {
                    // Joint constraint: connect two joints
                    const joint1 = model.getJoint(constraint.joint1);
                    const joint2 = model.getJoint(constraint.joint2);

                    if (joint1 && joint2) {
                        const body1Node = hierarchy.descendants().find(d => d.data.name === joint1.child);
                        const body2Node = hierarchy.descendants().find(d => d.data.name === joint2.child);

                        if (body1Node && body2Node) {
                            const x1 = body1Node.x + 50;
                            const y1 = body1Node.y + 50;
                            const x2 = body2Node.x + 50;
                            const y2 = body2Node.y + 50;

                            constraintGroup.append('line')
                                .attr('x1', x1)
                                .attr('y1', y1)
                                .attr('x2', x2)
                                .attr('y2', y2)
                                .style('stroke', '#ffff00')
                                .style('stroke-width', '2')
                                .style('stroke-dasharray', '3,3')
                                .style('opacity', '0.5')
                                .append('title')
                                .text(`Joint constraint: ${constraint.joint1} ↔ ${constraint.joint2}`);
                        }
                    }
                }
            });
        }

        if (previousTransform) {
            svg.call(zoom.transform, previousTransform);
            return;
        }

        // After initialization, auto-fit view to fill container
        // Use brief delay to ensure DOM is fully rendered
        setTimeout(() => {
            this.fitToView(false);
        }, 50);
    }

    /**
     * Build hierarchy data
     */
    buildHierarchy(linkName, model) {
        const link = model.links.get(linkName);
        if (!link) return null;

        const node = {
            name: linkName,
            data: link,
            children: []
        };

        // 1. Find child nodes through joints
        model.joints.forEach((joint, jointName) => {
            if (joint.parent === linkName && joint.child) {
                const childNode = this.buildHierarchy(joint.child, model);
                if (childNode) {
                    childNode.jointName = jointName;
                    childNode.jointType = joint.type;
                    node.children.push(childNode);
                }
            }
        });

        // 2. Find fixed-connected child bodies (child bodies without joints)
        model.links.forEach((childLink, childName) => {
            // Check if already added through joint
            const alreadyAdded = node.children.some(child => child.name === childName);
            if (!alreadyAdded && childLink.userData.parentName === linkName) {
                const childNode = this.buildHierarchy(childName, model);
                if (childNode) {
                    childNode.jointName = null; // Fixed connection, no joint
                    childNode.jointType = 'fixed';
                    childNode.isFixedConnection = true; // Mark as fixed connection
                    node.children.push(childNode);
                }
            }
        });

        return node;
    }

    /**
     * Setup document-level click handler (for clicks outside panel)
     */
    setupDocumentClickHandler() {
        // Remove previously existing listener first to avoid duplicate binding
        if (window.graphClickHandler) {
            document.removeEventListener('click', window.graphClickHandler, true);
        }

        window.graphClickHandler = (event) => {
            // Check if clicked element is within model structure graph
            const floatingPanel = document.getElementById('floating-model-tree');
            if (!floatingPanel || floatingPanel.style.display === 'none') {
                return; // Panel not visible, don't process
            }

            // Check if click is within panel
            if (!floatingPanel.contains(event.target)) {
                return; // Click outside panel, don't process
            }

            // Check click target
            const target = event.target;
            const tagName = target.tagName.toLowerCase();

            // Check if clicked node, joint label, or other interactive element
            const isNode = target.closest('.graph-node');
            const isJoint = target.closest('.graph-joint-group');
            const isHeader = target.closest('.floating-panel-header');

            // If not clicking node or joint, clear selection and measurement
            if (!isNode && !isJoint && !isHeader) {
                const svg = d3.select('#model-graph-svg');

                // Clear all selection states (including style reset)
                this.clearAllSelections(svg);

                // Clear measurement state
                if (this.measurementController) {
                    this.measurementController.clearMeasurement();
                }

                // Clear highlight and measurement in 3D scene
                if (this.sceneManager) {
                    this.sceneManager.highlightManager.clearHighlight();
                    this.sceneManager.measurementManager.clearMeasurement();
                }
            }
        };

        // Use capture phase to ensure event is captured
        document.addEventListener('click', window.graphClickHandler, true);
    }

    /**
     * Clear all selection states (unified handling, ensure styles are correctly reset)
     */
    clearAllSelections(svg) {
        // Get current theme
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const isLightTheme = currentTheme === 'light';
        const defaultBg = isLightTheme ? 'rgba(255, 255, 255, 0.95)' : 'rgba(42, 42, 46, 0.95)';

        // Clear all link node selection states
        svg.selectAll('.graph-node').classed('selected', false);
        svg.selectAll('.graph-node .node-border')
            .style('stroke', 'transparent');
        svg.selectAll('.graph-node .node-bg')
            .style('fill', defaultBg);

        // Clear all joint node selection states (including style reset)
        svg.selectAll('.graph-joint-group').classed('selected', false);
        svg.selectAll('.graph-joint-group .joint-capsule-border')
            .style('stroke', 'transparent');
        svg.selectAll('.graph-joint-group .joint-capsule-bg')
            .style('fill', defaultBg);

        // Clear all measurement selection states
        svg.selectAll('.graph-node').classed('measurement-selected', false);
        svg.selectAll('.graph-joint-group').classed('measurement-selected', false);
    }

    /**
     * Set measurement controller
     */
    setMeasurementController(controller) {
        this.measurementController = controller;
    }


    /**
     * Auto-fit view to fill container
     * @param {boolean} animated - Whether to use animation
     * @param {number} duration - Animation duration (milliseconds)
     */
    fitToView(animated = false, duration = 0) {
        if (!this.currentSvg || !this.currentContainer || !this.currentZoom) {
            return;
        }

        try {
            const svg = this.currentSvg.node();
            const svgRect = svg.getBoundingClientRect();
            if (svgRect.width === 0 || svgRect.height === 0) {
                return;
            }

            // Get bounding box of container content
            let bbox;
            try {
                bbox = this.currentContainer.node().getBBox();
            } catch (e) {
                return;
            }

            if (!bbox || bbox.width === 0 || bbox.height === 0) {
                return;
            }

            // Calculate appropriate scale ratio, leave some margin
            const padding = 50;
            const scaleX = (svgRect.width - padding * 2) / bbox.width;
            const scaleY = (svgRect.height - padding * 2) / bbox.height;
            let scale = Math.min(scaleX, scaleY);

            // Limit scale range
            scale = Math.max(0.1, Math.min(scale, 2.0));

            // Calculate centering translation
            const translateX = svgRect.width / 2 - (bbox.x + bbox.width / 2) * scale;
            const translateY = svgRect.height / 2 - (bbox.y + bbox.height / 2) * scale;

            // Create new transform
            const transform = d3.zoomIdentity
                .translate(translateX, translateY)
                .scale(scale);

            // Apply transform
            if (animated && duration > 0) {
                this.currentSvg.transition()
                    .duration(duration)
                    .call(this.currentZoom.transform, transform);
            } else {
                this.currentSvg.call(this.currentZoom.transform, transform);
            }
        } catch (error) {
            console.error('fitToView failed:', error);
        }
    }
}

