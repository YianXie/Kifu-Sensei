import { CommentaryConfig } from "website-template-frontend";

const noop = () => {};

export function Default() {
    return (
        <CommentaryConfig
            model="claude-haiku-4-5"
            setModel={noop}
            language="english"
            setLanguage={noop}
            numComments={20}
            setNumComments={noop}
            maxToken={1024}
            setMaxToken={noop}
            customInstruction=""
            setCustomInstruction={noop}
        />
    );
}

export function OpusJapanese() {
    return (
        <CommentaryConfig
            model="claude-opus-4-8"
            setModel={noop}
            language="japanese"
            setLanguage={noop}
            numComments={30}
            setNumComments={noop}
            maxToken={2048}
            setMaxToken={noop}
            customInstruction="Focus on the middlegame fighting and explain each tesuji in plain language."
            setCustomInstruction={noop}
        />
    );
}
