import TabType from "../../shared/TabType";
import { Pose2d, Translation2d } from "../../shared/geometry";
import { ALLIANCE_KEYS, getEnabledData, getIsRedAlliance } from "../../shared/log/LogUtil";
import LoggableType from "../../shared/log/LoggableType";
import { convert } from "../../shared/units";
import OdometryVisualizer from "../../shared/visualizers/OdometryVisualizer";
import TimelineVizController from "./TimelineVizController";

export default class OdometryController extends TimelineVizController {
  private HEATMAP_DT = 0.1;

  private GAME: HTMLInputElement;
  private GAME_SOURCE_LINK: HTMLElement;
  private UNIT_DISTANCE: HTMLInputElement;
  private UNIT_ROTATION: HTMLInputElement;
  private ORIGIN: HTMLInputElement;
  private SIZE: HTMLInputElement;
  private SIZE_TEXT: HTMLElement;
  private ALLIANCE_BUMPERS: HTMLInputElement;
  private ALLIANCE_ORIGIN: HTMLInputElement;
  private ORIENTATION: HTMLInputElement;

  private TRAIL_LENGTH_SECS = 5;
  private lastUnitDistance = "meters";

  constructor(content: HTMLElement) {
    let configBody = content.getElementsByClassName("timeline-viz-config")[0].firstElementChild as HTMLElement;
    super(
      content,
      TabType.Odometry,
      [],
      [
        {
          element: configBody.children[1].firstElementChild as HTMLElement,
          types: [LoggableType.NumberArray],
          options: [
            [
              "Robot",
              "Ghost",
              "Trajectory",
              "Vision Target",
              "Heatmap",
              "Heatmap (Enabled)",
              "Arrow (Front)",
              "Arrow (Center)",
              "Arrow (Back)"
            ]
          ]
        }
      ],
      new OdometryVisualizer(
        content.getElementsByClassName("odometry-canvas-container")[0] as HTMLElement,
        content.getElementsByClassName("odometry-heatmap-container")[0] as HTMLElement
      )
    );

    // Get option inputs
    this.GAME = configBody.children[1].children[1].children[1] as HTMLInputElement;
    this.GAME_SOURCE_LINK = configBody.children[1].children[1].children[2] as HTMLElement;
    this.UNIT_DISTANCE = configBody.children[2].children[0].children[1] as HTMLInputElement;
    this.UNIT_ROTATION = configBody.children[2].children[0].children[2] as HTMLInputElement;
    this.ORIGIN = configBody.children[3].children[0].lastElementChild as HTMLInputElement;
    this.SIZE = configBody.children[1].lastElementChild?.children[1] as HTMLInputElement;
    this.SIZE_TEXT = configBody.children[1].lastElementChild?.lastElementChild as HTMLElement;
    this.ALLIANCE_BUMPERS = configBody.children[2].lastElementChild?.children[1] as HTMLInputElement;
    this.ALLIANCE_ORIGIN = configBody.children[2].lastElementChild?.children[2] as HTMLInputElement;
    this.ORIENTATION = configBody.children[3].lastElementChild?.lastElementChild as HTMLInputElement;

    // Set default alliance values
    this.ALLIANCE_BUMPERS.value = "auto";
    this.ALLIANCE_ORIGIN.value = "blue";

    // Add initial set of options
    this.resetGameOptions();

    // Unit conversion for distance
    this.UNIT_DISTANCE.addEventListener("change", () => {
      let newUnit = this.UNIT_DISTANCE.value;
      if (newUnit !== this.lastUnitDistance) {
        let oldSize = Number(this.SIZE.value);
        if (newUnit === "meters") {
          this.SIZE.value = (Math.round(convert(oldSize, "inches", "meters") * 1000) / 1000).toString();
          this.SIZE.step = "0.01";
        } else {
          this.SIZE.value = (Math.round(convert(oldSize, "meters", "inches") * 100) / 100).toString();
          this.SIZE.step = "1";
        }
        this.SIZE_TEXT.innerText = newUnit;
        this.lastUnitDistance = newUnit;
      }
    });

    // Bind source link
    this.GAME.addEventListener("change", () => {
      let config = window.assets?.field2ds.find((game) => game.name === this.GAME.value);
      this.GAME_SOURCE_LINK.hidden = config !== undefined && config.sourceUrl === undefined;
    });
    this.GAME_SOURCE_LINK.addEventListener("click", () => {
      window.sendMainMessage(
        "open-link",
        window.assets?.field2ds.find((game) => game.name === this.GAME.value)?.sourceUrl
      );
    });

    // Enforce side length range
    this.SIZE.addEventListener("change", () => {
      if (Number(this.SIZE.value) < 0) this.SIZE.value = "0.1";
      if (Number(this.SIZE.value) === 0) this.SIZE.value = "0.1";
    });
  }

  /** Clears all options from the game selector then updates it with the latest options. */
  private resetGameOptions() {
    let value = this.GAME.value;
    while (this.GAME.firstChild) {
      this.GAME.removeChild(this.GAME.firstChild);
    }
    let options: string[] = [];
    if (window.assets !== null) {
      options = window.assets.field2ds.map((game) => game.name);
      options.forEach((title) => {
        let option = document.createElement("option");
        option.innerText = title;
        this.GAME.appendChild(option);
      });
    }
    if (options.includes(value)) {
      this.GAME.value = value;
    } else {
      this.GAME.value = options[0];
    }
    this.updateGameSourceLink();
  }

  /** Shows or hides the source link based on the selected game. */
  private updateGameSourceLink() {
    let fieldConfig = window.assets?.field2ds.find((game) => game.name === this.GAME.value);
    this.GAME_SOURCE_LINK.hidden = fieldConfig !== undefined && fieldConfig.sourceUrl === undefined;
  }

  get options(): { [id: string]: any } {
    return {
      game: this.GAME.value,
      unitDistance: this.UNIT_DISTANCE.value,
      unitRotation: this.UNIT_ROTATION.value,
      origin: this.ORIGIN.value,
      size: Number(this.SIZE.value),
      allianceBumpers: this.ALLIANCE_BUMPERS.value,
      allianceOrigin: this.ALLIANCE_ORIGIN.value,
      orientation: this.ORIENTATION.value
    };
  }

  set options(options: { [id: string]: any }) {
    this.resetGameOptions();
    this.GAME.value = options.game;
    this.UNIT_DISTANCE.value = options.unitDistance;
    this.UNIT_ROTATION.value = options.unitRotation;
    this.ORIGIN.value = options.origin;
    this.SIZE.value = options.size;
    this.SIZE_TEXT.innerText = options.unitDistance;
    this.lastUnitDistance = options.unitDistance;
    this.ALLIANCE_BUMPERS.value = options.allianceBumpers;
    this.ALLIANCE_ORIGIN.value = options.allianceOrigin;
    this.ORIENTATION.value = options.orientation;
    this.updateGameSourceLink();
  }

  newAssets() {
    this.resetGameOptions();
  }

  getAdditionalActiveFields(): string[] {
    if (this.ALLIANCE_BUMPERS.value === "auto" || this.ALLIANCE_ORIGIN.value === "auto") {
      return ALLIANCE_KEYS;
    } else {
      return [];
    }
  }

  getCommand(time: number) {
    // Returns the current value for a field
    let getCurrentValue = (key: string): Pose2d[] => {
      let logData = window.log.getNumberArray(key, time, time);
      if (
        logData &&
        logData.timestamps[0] <= time &&
        (logData.values[0].length === 2 || logData.values[0].length % 3 === 0)
      ) {
        let poses: Pose2d[] = [];
        if (logData.values[0].length === 2) {
          poses.push({
            translation: [
              convert(logData.values[0][0], this.UNIT_DISTANCE.value, "meters"),
              convert(logData.values[0][1], this.UNIT_DISTANCE.value, "meters")
            ],
            rotation: 0
          });
        } else {
          for (let i = 0; i < logData.values[0].length; i += 3) {
            poses.push({
              translation: [
                convert(logData.values[0][i], this.UNIT_DISTANCE.value, "meters"),
                convert(logData.values[0][i + 1], this.UNIT_DISTANCE.value, "meters")
              ],
              rotation: convert(logData.values[0][i + 2], this.UNIT_ROTATION.value, "radians")
            });
          }
        }
        return poses;
      } else {
      }
      return [];
    };

    // Get data
    let robotData: Pose2d[] = [];
    let trailData: Translation2d[][] = [];
    let ghostData: Pose2d[] = [];
    let trajectoryData: Pose2d[][] = [];
    let visionTargetData: Pose2d[] = [];
    let heatmapData: { timestamp: number; value: Translation2d }[] = [];
    let arrowFrontData: Pose2d[] = [];
    let arrowCenterData: Pose2d[] = [];
    let arrowBackData: Pose2d[] = [];
    this.getListFields()[0].forEach((field) => {
      switch (field.type) {
        case "Robot":
          let currentRobotData = getCurrentValue(field.key);
          robotData = robotData.concat(currentRobotData);

          // Get trails
          let trailsTemp: Translation2d[][] = currentRobotData.map(() => []);
          let trailLogData = window.log.getNumberArray(
            field.key,
            time - this.TRAIL_LENGTH_SECS,
            time + this.TRAIL_LENGTH_SECS
          );
          if (trailLogData) {
            if (time - trailLogData.timestamps[0] > this.TRAIL_LENGTH_SECS) {
              trailLogData.timestamps.shift();
              trailLogData.values.shift();
            }
            if (trailLogData.timestamps[trailLogData.timestamps.length - 1] - time > this.TRAIL_LENGTH_SECS) {
              trailLogData.timestamps.pop();
              trailLogData.values.pop();
            }
            trailLogData.values.forEach((value) => {
              if (value.length % 3 === 0) {
                for (let i = 0; i < value.length / 3; i += 1) {
                  if (i >= trailsTemp.length) continue;
                  trailsTemp[i].push([
                    convert(value[i * 3], this.UNIT_DISTANCE.value, "meters"),
                    convert(value[i * 3 + 1], this.UNIT_DISTANCE.value, "meters")
                  ]);
                }
              }
            });
          }
          trailData = trailData.concat(trailsTemp);
          break;
        case "Ghost":
          ghostData = ghostData.concat(getCurrentValue(field.key));
          break;
        case "Trajectory":
          trajectoryData.push(getCurrentValue(field.key));
          break;
        case "Vision Target":
          visionTargetData = visionTargetData.concat(getCurrentValue(field.key));
          break;
        case "Heatmap":
        case "Heatmap (Enabled)":
          let enabledFilter = field.type === "Heatmap (Enabled)";
          let enabledData = enabledFilter ? getEnabledData(window.log) : null;
          let distanceConversion = convert(1, this.UNIT_DISTANCE.value, "meters");

          let heatmapLogData = window.log.getNumberArray(field.key, -Infinity, Infinity);
          if (heatmapLogData) {
            heatmapLogData.values.forEach((value, index) => {
              // Check if enabled
              let timestamp = heatmapLogData!.timestamps[index];
              if (enabledFilter) {
                let enabledDataIndex = enabledData!.timestamps.findLastIndex((x) => x <= timestamp);
                if (enabledDataIndex === -1) return;
                let enabled = enabledData!.values[enabledDataIndex];
                if (!enabled) return;
              }

              // Generate samples
              let nextTimestamp =
                index < heatmapLogData!.timestamps.length - 1 ? heatmapLogData!.timestamps[index + 1] : timestamp;
              let sampleCount = Math.ceil((nextTimestamp - timestamp) / this.HEATMAP_DT);
              for (let i = 0; i < sampleCount; i++) {
                if (value.length % 3 === 0) {
                  for (let i = 0; i < value.length / 3; i += 1) {
                    heatmapData.push({
                      timestamp: timestamp + i * this.HEATMAP_DT,
                      value: [value[i * 3] * distanceConversion, value[i * 3 + 1] * distanceConversion]
                    });
                  }
                }
              }
            });
          }
          break;
        case "Arrow (Front)":
          arrowFrontData = arrowFrontData.concat(getCurrentValue(field.key));
          break;
        case "Arrow (Center)":
          arrowCenterData = arrowCenterData.concat(getCurrentValue(field.key));
          break;
        case "Arrow (Back)":
          arrowBackData = arrowBackData.concat(getCurrentValue(field.key));
          break;
      }
    });

    // Filter heatmap data (remove samples with too small dts)
    let heatmapDataValues: Translation2d[] = [];
    let lastTimestamp = 0;
    heatmapData.sort((a, b) => a.timestamp - b.timestamp);
    heatmapData.forEach((sample) => {
      if (sample.timestamp === lastTimestamp || sample.timestamp - lastTimestamp >= this.HEATMAP_DT) {
        heatmapDataValues.push(sample.value);
        lastTimestamp = sample.timestamp;
      }
    });

    // Get alliance colors
    let allianceRedBumpers = false;
    let allianceRedOrigin = false;
    let autoRedAlliance = getIsRedAlliance(window.log);
    switch (this.ALLIANCE_BUMPERS.value) {
      case "auto":
        allianceRedBumpers = autoRedAlliance;
        break;
      case "blue":
        allianceRedBumpers = false;
        break;
      case "red":
        allianceRedBumpers = true;
        break;
    }
    switch (this.ALLIANCE_ORIGIN.value) {
      case "auto":
        allianceRedOrigin = autoRedAlliance;
        break;
      case "blue":
        allianceRedOrigin = false;
        break;
      case "red":
        allianceRedOrigin = true;
        break;
    }

    // Package command data
    return {
      poses: {
        robot: robotData,
        trail: trailData,
        ghost: ghostData,
        trajectory: trajectoryData,
        visionTarget: visionTargetData,
        heatmap: heatmapDataValues,
        arrowFront: arrowFrontData,
        arrowCenter: arrowCenterData,
        arrowBack: arrowBackData
      },
      options: this.options,
      allianceRedBumpers: allianceRedBumpers,
      allianceRedOrigin: allianceRedOrigin
    };
  }
}
