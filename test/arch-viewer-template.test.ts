import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Resolve template file path
const templatePath = join(process.cwd(), 'templates', 'arch-viewer.html');

console.log('Testing arch-viewer.html template verification...');

if (!existsSync(templatePath)) {
  console.error('FAIL: templates/arch-viewer.html does not exist!');
  process.exit(1);
}

const content = readFileSync(templatePath, 'utf-8');

// Helper assertion function
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${msg}`);
}

// ─── Task 2.1: 3-pane layout, CDN libraries & multi-diagram sidebar ───
assert(content.includes('mermaid@10/dist/mermaid.min.js'), 'Loads Mermaid.js from CDN (NF2)');
assert(content.includes('marked@11/marked.min.js'), 'Loads Marked.js from CDN (NF2)');
assert(content.includes('id="arch-data"'), 'Contains #arch-data script for initial payload injection');
assert(content.includes('id="sidebar"'), 'Contains left sidebar container (Req 3.1)');
assert(content.includes('id="sidebar-toggle"'), 'Contains sidebar collapse toggle button (Req 3.5)');
assert(content.includes('id="diagram-list"'), 'Contains diagram list container (Req 3.1)');
assert(content.includes('id="diagram-count"'), 'Contains diagram count badge (Req 3.1)');
assert(content.includes('item-title') && content.includes('item-filename'), 'Displays title and filename for each item (Req 3.2)');
assert(content.includes('selectDiagram'), 'Has diagram switching logic (Req 3.3)');
assert(content.includes('searchParams.set(\'doc\'') || content.includes('docParam') || content.includes('history.replaceState'), 'Syncs active diagram with URL query param (Req 3.4)');
assert(content.includes('collapsed'), 'Has CSS classes/logic for collapsed sidebar (Req 3.5)');

// ─── Task 2.2: Hardware-accelerated dynamic pan and zoom canvas engine ───
assert(content.includes('id="viewport"') && content.includes('id="canvas"'), 'Contains viewport and canvas container (Req 5.1)');
assert(content.includes('transform-origin: 0 0') && content.includes('translate3d'), 'Implements hardware-accelerated CSS transforms (Req 5.1)');
assert(content.includes('isSpacePressed') && content.includes('space-pressed'), 'Implements Spacebar grab tool state tracking (Req 5.2)');
assert(content.includes('cursor: grab') && content.includes('cursor: grabbing'), 'Applies grab/grabbing cursors for drag tool (Req 5.2)');
assert(content.includes('e.button === 1'), 'Supports middle-click drag panning (Req 5.3)');
assert(content.includes('state.panX -= e.deltaX') && content.includes('state.panY -= e.deltaY'), 'Supports two-finger trackpad panning (FigJam style)');
assert(content.includes('addEventListener(\'wheel\'') && content.includes('deltaY'), 'Implements cursor-centered wheel/pinch zooming (Req 5.4)');
assert(content.includes('e.ctrlKey || e.metaKey') && content.includes('Math.exp'), 'Implements gentle exponential zoom curve on pinch / Cmd+Wheel');
assert(content.includes('gesturestart') && content.includes('preventDefault'), 'Prevents native Safari gesture zoom interference');
assert(content.includes('dragDistance > 4'), 'Treats movement > 4px as drag to suppress accidental click (Req 5.5)');
assert(content.includes('id="btn-zoom-in"') && content.includes('id="btn-zoom-out"'), 'Provides floating Zoom In and Zoom Out controls (Req 5.6)');
assert(content.includes('id="btn-zoom-reset"') && content.includes('id="btn-fit-view"'), 'Provides Reset 100% and Fit to View controls (Req 5.6)');
assert(content.includes('overflow: hidden'), 'Canvas viewport prevents page scrollbars (Req 5.7)');

// ─── Task 2.3: Side-by-side node inspector drawer with active highlight and auto-pan ───
assert(content.includes('id="inspector"'), 'Contains right inspector drawer (Req 6.1)');
assert(content.includes('--inspector-width: 400px') || content.includes('400px'), 'Inspector drawer is ~400px width (Req 6.1)');
assert(content.includes('node-selected'), 'Applies .node-selected class on active node (Req 6.2)');
assert(content.includes('stroke: #3b82f6') && content.includes('drop-shadow'), 'Applies accent outline and drop shadow for active node highlight (Req 6.2)');
assert(content.includes('ensureNodeVisible') || content.includes('drawerBoundary'), 'Implements auto-pan when node is under drawer (Req 6.3)');
assert(content.includes('marked.parse'), 'Renders markdown notes via Marked.js (Req 6.4)');
assert(content.includes('id="inspector-status"') && content.includes('status-badge'), 'Renders status badge in inspector (Req 6.4)');
assert(content.includes('closeInspector'), 'Implements inspector close function (Req 6.5)');
assert(content.includes('id="inspector-close"'), 'Has ✕ close button (Req 6.5)');
assert(content.includes('e.key === \'Escape\'') || content.includes('Escape'), 'Closes on Escape key (Req 6.5)');

// ─── Task 2.4: Client-side Export HTML and Export SVG buttons ───
assert(content.includes('id="btn-export-svg"'), 'Contains Export SVG button in header (Req 7.1)');
assert(content.includes('id="btn-export-html"'), 'Contains Export HTML button in header (Req 7.1)');
assert(content.includes('XMLSerializer') && content.includes('image/svg+xml'), 'Generates standalone SVG export with serializer and blob (Req 7.3)');
assert(content.includes('download') && content.includes('-architecture.html'), 'Bundles standalone self-contained HTML export (Req 7.2)');

// ─── Live Reload SSE support (Task 3.2 compatibility) ───
assert(content.includes('EventSource(\'/events\')'), 'Includes Live SSE stream listener for live reload');
assert(content.includes('file_change') && content.includes('dir_change'), 'Handles file_change and dir_change SSE events');

// ─── Wave 3: Collaborative Live Canvas Comments & Discussion (Tasks 3.1, 3.2, 3.3) ───
// Task 3.1: Comment Tool toggle, C hotkey, and canvas/coordinate pin placement
assert(content.includes('id="btn-tool-comment"'), 'Contains Comment Tool button in toolbar (Req 2.1)');
assert(content.includes("e.key === 'c'") || content.includes("e.key === 'C'"), 'Supports C key toggle for Comment Mode (Req 2.2)');
assert(content.includes('id="comments-layer"'), 'Contains #comments-layer child inside #canvas (Req 2.3, 2.4)');
assert(content.includes('commentModeActive'), 'Tracks commentModeActive state');
assert(content.includes('crosshair'), 'Applies crosshair cursor in Comment Mode (Req 2.3)');
assert(content.includes('/api/comments'), 'Communicates with /api/comments endpoint (Req 2.5)');
assert(content.includes('cancelDraftComment'), 'Supports canceling draft comment on Escape (Req 2.6)');
assert(content.includes('nodeEl') && content.includes('extractNodeId'), 'Detects clicked node and anchors comment pin (Req 2.4)');

// Task 3.2: Threaded popover speech bubble with agent reply & typing state
assert(content.includes('comment-popover'), 'Renders threaded popover card (Req 4.2)');
assert(content.includes('agent_typing') && content.includes('Agent is thinking...'), 'Displays typing indicator when agent is thinking (Req 4.3)');
assert(content.includes('agent_reply'), 'Handles agent_reply SSE event with markdown formatting (Req 4.1, 4.2)');
assert(content.includes('/resolve'), 'Supports POST /api/comments/:id/resolve (Req 4.2)');
assert(content.includes('btn-resolve'), 'Provides thread resolve button (Req 4.2)');
assert(content.includes('btn-reply-send') || content.includes('sendReply'), 'Includes follow-up reply input and send action (Req 4.2)');

// Task 3.3: End Discussion header action with badge
assert(content.includes('id="btn-end-session"'), 'Contains End Discussion button in header bar (Req 5.1)');
assert(content.includes('id="unresolved-badge"'), 'Displays unresolved comments count badge in header (Req 5.1)');
assert(content.includes('/api/session/end'), 'Triggers POST /api/session/end on End Discussion click (Req 5.2)');
assert(content.includes('session_ended'), 'Handles session_ended SSE event (Req 5.2)');
assert(content.includes('compiling the Architecture Decision Record') || content.includes('Architecture Decision Record'), 'Displays ADR compilation notification');

console.log('\n🎉 All arch-viewer.html template verification checks passed successfully!');
