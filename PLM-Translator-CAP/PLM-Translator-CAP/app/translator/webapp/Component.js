sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "sap/ui/model/json/JSONModel",
    "./model/api",
    "./model/theme"
], function (UIComponent, Device, JSONModel, api, theme) {
    "use strict";

    return UIComponent.extend("dn.translator.Component", {
        metadata: {
            manifest: "json",
            interfaces: ["sap.ui.core.IAsyncContentCreation"]
        },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);

            const deviceModel = new JSONModel(Device);
            deviceModel.setDefaultBindingMode("OneWay");
            this.setModel(deviceModel, "device");

            // Target languages offered by Google: [{code, name}], loaded once for every page
            const languagesModel = new JSONModel([]);
            languagesModel.setSizeLimit(1000);
            this.setModel(languagesModel, "languages");
            this.languagesLoaded = api.languages()
                .then((languages) => {
                    languagesModel.setData(languages);
                    return languages;
                })
                .catch(() => []);

            theme.init();
            this.getRouter().initialize();
        },

        /** Compact controls on desktop, cozy on touch devices */
        getContentDensityClass: function () {
            return Device.support.touch ? "sapUiSizeCozy" : "sapUiSizeCompact";
        }
    });
});
