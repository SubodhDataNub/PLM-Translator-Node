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

            const languagesModel = new JSONModel([]);
            languagesModel.setSizeLimit(1000);
            this.setModel(languagesModel, "languages");
            this.languagesLoaded = api.languages()
                .then((languages) => {
                    languagesModel.setData(languages);
                    return languages;
                })
                .catch(() => []);

            const userModel = new JSONModel({ user: "", isAdmin: false, loaded: false });
            this.setModel(userModel, "user");
            this.userLoaded = api.userInfo()
                .then((info) => {
                    userModel.setData({ user: info.user || "", isAdmin: Boolean(info.isAdmin), loaded: true });
                    return userModel.getData();
                })
                .catch(() => {
                    userModel.setProperty("/loaded", true);
                    return userModel.getData();
                });

            theme.init();
            this.getRouter().initialize();
        },

        getContentDensityClass: function () {
            return Device.support.touch ? "sapUiSizeCozy" : "sapUiSizeCompact";
        }
    });
});
