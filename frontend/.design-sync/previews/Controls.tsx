import { Controls } from "website-template-frontend";

const noop = () => {};

export function Default() {
    return <Controls maxMove={180} currentMoveIndex={42} onMoveChange={noop} />;
}

export function AtStart() {
    return <Controls maxMove={180} currentMoveIndex={0} onMoveChange={noop} />;
}

export function AtEnd() {
    return <Controls maxMove={180} currentMoveIndex={180} onMoveChange={noop} />;
}

export function WithCommentJumps() {
    return (
        <Controls
            maxMove={180}
            currentMoveIndex={42}
            onMoveChange={noop}
            onJumpToPreviousComment={noop}
            onJumpToNextComment={noop}
            hasPreviousCommentMove
            hasNextCommentMove
        />
    );
}
