sap.ui.define([], function () {
    "use strict";

    return {
        countCharacters(text) {
            text = String(text || "");
            if (window.Intl && Intl.Segmenter) {
                return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)).length;
            }
            return Array.from(text).length;
        },

        countWords(text, language) {
            text = String(text || "");
            if (window.Intl && Intl.Segmenter) {
                let segmenter;
                try {
                    segmenter = new Intl.Segmenter(language, { granularity: "word" });
                } catch (error) {
                    segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
                }
                return Array.from(segmenter.segment(text)).filter((segment) => segment.isWordLike).length;
            }
            return text.trim().split(/\s+/).filter(Boolean).length;
        },

        formatFileSize(bytes) {
            if (!bytes) return "0 Bytes";
            const k = 1024;
            const sizes = ["Bytes", "KB", "MB", "GB"];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
        },

        formatDuration(minutes, hours) {
            if (hours >= 1) return `${hours.toFixed(1)} hours`;
            if (minutes >= 1) return `${Math.round(minutes)} minutes`;
            return `${Math.round(minutes * 60)} seconds`;
        }
    };
});
