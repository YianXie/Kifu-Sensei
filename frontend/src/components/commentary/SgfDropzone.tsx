import { useState } from "react";

import { Icon } from "@/components/ui";

/** The .sgf upload target on the Commentary page. */
export default function SgfDropzone({
    id = "sgf-upload",
    fileName,
    state = "idle",
    onFile,
    className = "",
}: {
    id?: string;
    fileName?: string | null;
    state?: "idle" | "error";
    onFile: (file: File | undefined) => void;
    className?: string;
}) {
    const [dragOver, setDragOver] = useState(false);
    const resolved = dragOver ? "over" : fileName ? "filled" : state;
    const label =
        resolved === "over"
            ? "Drop .sgf file here"
            : resolved === "error"
              ? "Only .sgf file is supported"
              : (fileName ?? "Click or drag to upload .sgf file");

    return (
        <label
            className={`ks-dropzone ks-dropzone--${resolved} ${className}`.trim()}
            htmlFor={id}
            onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
            }}
            onDragLeave={(event) => {
                event.preventDefault();
                setDragOver(false);
            }}
            onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                onFile(event.dataTransfer.files?.[0]);
            }}
        >
            <input
                id={id}
                type="file"
                accept=".sgf"
                hidden
                onChange={(event) => {
                    onFile(event.target.files?.[0]);
                    // Re-selecting the same file after removing it still fires
                    // a change event only if the value is cleared first.
                    event.target.value = "";
                }}
            />
            <Icon name={fileName ? "description" : "cloud_upload"} />
            <span className="ks-dropzone__label">{label}</span>
        </label>
    );
}
