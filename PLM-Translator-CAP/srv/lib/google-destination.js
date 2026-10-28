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

module.exports = { DESTINATION_NAME, hasDestinationService };
