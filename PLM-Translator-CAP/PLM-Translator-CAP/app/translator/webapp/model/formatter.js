sap.ui.define([], function () {
    "use strict";

    function isFailure(outcome) {
        return outcome === "Failed" || outcome === "Failure";
    }

    function pad(value) {
        return String(value).padStart(2, "0");
    }

    return {
        outcomeText(outcome) {
            if (isFailure(outcome)) return "Failed";
            return outcome || "Unknown";
        },

        outcomeState(outcome) {
            if (outcome === "Success") return "Success";
            if (outcome === "Partial") return "Warning";
            if (isFailure(outcome)) return "Error";
            return "None";
        },

        outcomeIcon(outcome) {
            if (outcome === "Success") return "sap-icon://sys-enter-2";
            if (outcome === "Partial") return "sap-icon://alert";
            if (isFailure(outcome)) return "sap-icon://error";
            return "sap-icon://question-mark";
        },

        accuracyPercent(accuracy) {
            const value = Number(accuracy);
            return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
        },

        accuracyText(accuracy) {
            return accuracy ? `${Number(accuracy).toFixed(1)}%` : "–";
        },

        accuracyState(accuracy) {
            const value = Number(accuracy) || 0;
            if (value >= 80) return "Success";
            if (value >= 60) return "Warning";
            return "Error";
        },

        hasAccuracy(accuracy) {
            return Boolean(accuracy);
        },

        noAccuracy(accuracy) {
            return !accuracy;
        },

        createdUtc(createdAt) {
            if (!createdAt) return "–";
            const date = new Date(createdAt);
            if (Number.isNaN(date.getTime())) return String(createdAt);
            return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
                `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
        },

        dateTime(value) {
            if (!value) return "–";
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? String(value) : `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
        },

        orDash(value) {
            return value === null || value === undefined || value === "" ? "–" : String(value);
        }
    };
});
