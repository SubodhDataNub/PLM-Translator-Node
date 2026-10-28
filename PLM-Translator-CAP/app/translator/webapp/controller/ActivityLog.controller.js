sap.ui.define([
    "./BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "../model/api",
    "../model/formatter"
], function (BaseController, JSONModel, MessageBox, api, formatter) {
    "use strict";

    const PAGE_SIZE = 50;

    return BaseController.extend("dn.translator.controller.ActivityLog", {
        formatter,

        onInit() {
            this.getView().setModel(new JSONModel({
                search: "",
                user: "",
                activity: "",
                users: [{ key: "", text: this.text("activityAllUsers") }],
                tableTitle: this.text("activityTable")
            }), "view");

            this._template = this.byId("activityRowTemplate");
            this.byId("activityTable").setGrowingThreshold(PAGE_SIZE);

            this.getRouter().getRoute("activity").attachPatternMatched(this._onRouteMatched, this);
        },

        async _onRouteMatched() {
            const user = await this.userLoaded();
            if (!user.isAdmin) {
                MessageBox.warning(this.text("activityNotAllowed"));
                this.getRouter().navTo("translate", {}, true);
                return;
            }
            this._loadUsers();
            this._load();
        },

        activityText(activity) {
            const key = `activity_${activity}`;
            const bundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
            return bundle.hasText(key) ? bundle.getText(key) : (activity || "–");
        },

        onFilterChange() {
            this._load();
        },

        onClearFilters() {
            const model = this.getViewModel();
            model.setProperty("/search", "");
            model.setProperty("/user", "");
            model.setProperty("/activity", "");
            this._load();
        },

        onRefresh() {
            this._loadUsers();
            this._load();
        },

        _load() {
            const { search, user, activity } = this.getViewModel().getData();
            const parameters = { $count: true, $orderby: "createdAt desc" };
            const $filter = api.activityFilter({ user, activity, search });
            if ($filter) parameters.$filter = $filter;

            this.byId("activityTable").bindItems({
                path: "/ActivityLog",
                parameters,
                template: this._template,
                templateShareable: true,
                events: {
                    change: () => this._updateCount(),
                    dataReceived: (event) => {
                        const error = event.getParameter("error");
                        if (error) MessageBox.error(this.text("activityLoadFailed", [this.errorMessage(error)]));
                    }
                }
            });
        },

        _updateCount() {
            const binding = this.byId("activityTable").getBinding("items");
            if (!binding) return;
            const label = this.text("activityTable");
            binding.getHeaderContext().requestProperty("$count").then((count) => {
                this.getViewModel().setProperty("/tableTitle",
                    count === undefined ? label : `${label} (${Number(count).toLocaleString()})`);
            });
        },

        async _loadUsers() {
            try {
                const users = await api.activityUsers();
                this.getViewModel().setProperty("/users", [
                    { key: "", text: this.text("activityAllUsers") },
                    ...users.map((name) => ({ key: name, text: name }))
                ]);
            } catch (error) {
            }
        }
    });
});
