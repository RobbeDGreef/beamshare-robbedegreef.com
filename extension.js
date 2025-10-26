import GObject from "gi://GObject";
import St from "gi://St";
import Gio from "gi://Gio";
import Clutter from "gi://Clutter";

import {
  Extension,
  gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

/* Gio.Subprocess */
Gio._promisify(Gio.Subprocess.prototype, "communicate_utf8_async");
Gio._promisify(Gio.Subprocess.prototype, "wait_async");

const BEAMSHARE_BIN = "beamshare";

const Indicator = GObject.registerClass(
  class Indicator extends PanelMenu.Button {
    _init() {
      super._init(0.0, _("Beamshare"));

      this.add_child(
        new St.Icon({
          icon_name: "x-office-presentation-symbolic",
          style_class: "system-status-icon",
        })
      );

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_("Monitor")));
      this._selectedMonitorIdx = null;

      // The share button which will initiate sharing.
      this.shareButton = new PopupMenu.PopupMenuItem(_("Share"));
      this.shareButton.connect("activate", () => {
        if (this._share_proc) {
          this._stopSharing();
        } else {
          this._startSharing();
        }
      });

      // Create dropdown menu to select a monitor
      this.monitorMenu = new PopupMenu.PopupSubMenuMenuItem(
        _("Select Monitor")
      );

      this.monitorMenu.menu.addMenuItem(
        new PopupMenu.PopupMenuItem(_("Loading..."), { activate: false })
      );

      this.monitorMenu.menu.connect("open-state-changed", () => {
        console.log("Monitor menu opened");
        this._refreshMonitors();
      });

      this.menu.addMenuItem(this.monitorMenu);
      this.menu.addMenuItem(this.shareButton);
    }

    _refreshMonitors() {
      console.log("Refreshing monitors");
      this.monitorMenu.menu.removeAll();

      this.monitorMenu.menu.addMenuItem(
        new PopupMenu.PopupMenuItem(_("Loading..."), { activate: false })
      );

      this._getMonitors()
        .then(this._populateMonitors.bind(this))
        .catch((err) => {
          console.log("Error getting monitors:", err);
          Main.notify(
            _("Error retrieving monitors"),
            _("Error retrieving monitors") + ": " + err.message
          );
        });
    }

    _populateMonitors(monitors) {
      this.monitorMenu.menu.removeAll();

      console.log("Populating monitors:", monitors);
      let monitorSubMenus = [];

      let selectMonitor = (monitorIdx) => {
        this._selectedMonitor = monitors[monitorIdx];

        // Remove the ornament of all other submenus
        for (const menu of monitorSubMenus) {
          menu.setOrnament(PopupMenu.Ornament.NONE);
        }

        // Give the currently selected one the correct ornament
        let item = monitorSubMenus[monitorIdx];
        item.setOrnament(PopupMenu.Ornament.CHECK);

        this.monitorMenu.label.text = monitors[monitorIdx].description;
      };

      let idx = 0;
      for (const monitor of monitors) {
        let item = new PopupMenu.PopupMenuItem(_(monitor.description), {
          activate: true,
          can_focus: true,
          hover: true,
          reactive: true,
        });
        // let bouton = new St.Button({ child: _(monitor.description) });
        // item.actor.add_child(bouton);

        // Javascript is returning a reference
        // so I have to copy it to get the actual
        // value, ugh.
        let idx2 = idx;
        item.connect("activate", (item, event) => {
          selectMonitor(idx2);

          // There is no way to keep the menu open after clicking a submenu
          // so we have to use this stupid hack.
          setTimeout(() => {
            this.menu.open(false);
          }, 1);

          return Clutter.EVENT_STOP;
        });
        monitorSubMenus.push(item);
        this.monitorMenu.menu.addMenuItem(item);
        idx += 1;
      }
    }

    async _getMonitors() {
      try {
        const proc = Gio.Subprocess.new(
          [BEAMSHARE_BIN, "list-monitors"],
          Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );

        await proc.wait_async(null);

        let [stdout, stderr] = await proc.communicate_utf8_async(null, null);

        if (!stdout) {
          throw new Error(`Error executing ${BEAMSHARE_BIN}: ${stderr}`);
        }

        let monitors = JSON.parse(stdout);

        return monitors;
      } catch (err) {
        console.log(err);
        Main.notify(
          _("Error retrieving monitors"),
          _("Error retrieving monitors") + ": " + err.message
        );
        return [];
      }
    }

    async _startSharing() {
      if (!this._selectedMonitor) {
        Main.notify(
          _("No monitor selected"),
          _("Please select a monitor to share.")
        );
        return;
      }

      try {
        this._share_proc = Gio.Subprocess.new(
          [BEAMSHARE_BIN, "share", this._selectedMonitor.name],
          Gio.SubprocessFlags.NONE
        );

        this.shareButton.label.text = "Stop sharing";

        const cancellable = new Gio.Cancellable();
        await this._share_proc.wait_async(cancellable);

        Main.notify(
          _("Sharing finished"),
          _("You are no longer sharing your monitor.")
        );
      } catch (err) {
        console.log(err);
        Main.notify(
          _("Error sharing"),
          _("Error sharing") + ": " + err.message
        );
      }

      this.shareButton.label.text = "Share";
      this._share_proc = null;
    }

    _stopSharing() {
      if (this._share_proc) {
        this._share_proc.force_exit();
        this._share_proc = null;

        this.shareButton.label.text = "Share";
      }
    }
  }
);

export default class IndicatorExampleExtension extends Extension {
  enable() {
    this._indicator = new Indicator();
    Main.panel.addToStatusArea(this.uuid, this._indicator);
  }

  disable() {
    this._indicator.destroy();
    this._indicator = null;
  }
}
