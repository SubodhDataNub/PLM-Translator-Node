sap.ui.define([
    "./BaseController",
    "sap/ui/Device",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "../model/theme"
], function (BaseController, Device, Fragment, JSONModel, MessageToast, theme) {
    "use strict";

    return BaseController.extend("dn.translator.controller.App", {
        onInit() {
            const view = this.getView();
            view.addStyleClass(this.getOwnerComponent().getContentDensityClass());
            view.setModel(new JSONModel({ selectedKey: "translate", theme: theme.getChoice() }), "app");

            if (Device.system.phone) {
                this.byId("toolPage").setSideExpanded(false);
            }

            // Highlight the page in the side navigation
            this.getRouter().attachRouteMatched((event) => {
                view.getModel("app").setProperty("/selectedKey", event.getParameter("name"));
            });

            this._onOnline = () => MessageToast.show(this.text("online"));
            this._onOffline = () => MessageToast.show(this.text("offline"));
            window.addEventListener("online", this._onOnline);
            window.addEventListener("offline", this._onOffline);
        },

        onExit() {
            window.removeEventListener("online", this._onOnline);
            window.removeEventListener("offline", this._onOffline);
        },

        onSideNavToggle() {
            const toolPage = this.byId("toolPage");
            toolPage.setSideExpanded(!toolPage.getSideExpanded());
        },

        onNavItemSelect(event) {
            this.getRouter().navTo(event.getParameter("item").getKey());
            if (Device.system.phone) {
                this.byId("toolPage").setSideExpanded(false);
            }
        },

        async onThemeMenu(event) {
            const button = event.getSource();
            if (!this._themePopover) {
                this._themePopover = await Fragment.load({
                    id: this.getView().getId(),
                    name: "dn.translator.view.ThemePopover",
                    controller: this
                });
                this.getView().addDependent(this._themePopover);
            }
            this._themePopover.openBy(button);
        },

        onThemeSelect(event) {
            const choice = event.getParameter("listItem").data("theme");
            theme.setChoice(choice);
            this.getView().getModel("app").setProperty("/theme", theme.getChoice());
            this._themePopover.close();
        }
    });
});
