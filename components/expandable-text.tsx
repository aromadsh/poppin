"use client";

import { useEffect, useId, useRef, useState } from "react";

/** Clamp descriptive copy while leaving the full text available on demand. */
export function ExpandableText({ text, label }: { text: string; label: string }) {
  return <ExpandableTextContent key={text} text={text} label={label}/>;
}

function ExpandableTextContent({ text, label }: { text: string; label: string }) {
  const id = useId();
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    if (expanded || !paragraph.current) return;
    const node = paragraph.current;
    const measure = () => setOverflowing(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text, expanded]);
  return <div className="expandable-text">
    <p id={id} ref={paragraph} className={expanded ? "descriptive-copy expanded" : "descriptive-copy"}>{text}</p>
    <div className="text-toggle-slot">{overflowing && <button type="button" aria-controls={id} aria-expanded={expanded} aria-label={`${label} ${expanded ? "접기" : "더보기"}`} onClick={() => setExpanded(value => !value)}>{expanded ? "접기" : "더보기"}</button>}</div>
  </div>;
}
