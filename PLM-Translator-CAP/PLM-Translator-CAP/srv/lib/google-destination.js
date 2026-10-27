'use strict';

const DESTINATION_NAME = process.env.GOOGLE_TRANSLATE_DESTINATION || 'google-translation';

function hasDestinationService() {
    if (process.env.destinations) return true;
    try {
        const services = JSON.parse(process.env.VCAP_SERVICES || '{}');
        return Array.isArray(services.destination) && services.destination.length > 0;
    } catch (e) {
        return false;
    }
}

function destinationProperties(destination) {
    const original = destination.originalProperties || {};
    return { ...destination, ...(original.destinationConfiguration || original) };
}

async function readGoogleDestination() {
    if (!hasDestinationService()) return null;

    const { getDestination } = require('@sap-cloud-sdk/connectivity');
    const destination = await getDestination({ destinationName: DESTINATION_NAME, useCache: false });
    if (!destination) {
        throw new Error(`Destination "${DESTINATION_NAME}" not found`);
    }

    const props = destinationProperties(destination);
    return {
        credentialsJson: props.GoogleCredentialsJson,
        apiKey: props.GoogleApiKey,
        projectId: props.GoogleProjectId,
        location: props.GoogleLocation,
        model: props.GoogleModel
    };
}

module.exports = { DESTINATION_NAME, hasDestinationService, readGoogleDestination };
