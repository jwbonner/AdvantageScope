import * as THREE from "three";
import { Quaternion, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { Config3d_Rotation } from "../FRCData";
import { convert } from "../units";
import Visualizer from "./Visualizer";

export default class ThreeDimensionVisualizer implements Visualizer {
  private EFFICIENCY_MAX_FPS = 15;
  private ORBIT_FOV = 50;
  private ORBIT_DEFAULT_TARGET = new THREE.Vector3(0, 0.5, 0);
  private ORBIT_FIELD_DEFAULT_POSITION = new THREE.Vector3(0, 6, -12);
  private ORBIT_ROBOT_DEFAULT_POSITION = new THREE.Vector3(2, 1, 1);
  private WPILIB_ROTATION = this.getQuaternionFromRotSeq([
    {
      axis: "x",
      degrees: -90
    },
    {
      axis: "y",
      degrees: 180
    }
  ]);

  private content: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private wpilibCoordinateGroup: THREE.Group; // Rotated to match WPILib coordinates
  private wpilibFieldCoordinateGroup: THREE.Group; // Field coordinates (origin at driver stations and flipped based on alliance)
  private field: THREE.Object3D | null = null;
  private robot: THREE.Object3D | null = null;
  private robotCameras: THREE.Object3D[] = [];
  private greenCones: THREE.Object3D[] = [];
  private blueCones: THREE.Object3D[] = [];
  private yellowCones: THREE.Object3D[] = [];

  private command: any;
  private shouldRender = false;
  private cameraIndex = -1;
  private lastCameraIndex = -1;
  private lastFrameTime = 0;
  private lastWidth: number | null = 0;
  private lastHeight: number | null = 0;
  private lastDevicePixelRatio: number | null = null;
  private lastIsDark: boolean | null = null;
  private lastAspectRatio: number | null = null;
  private lastPrefsMode = "";
  private lastFrcDataString: string = "";
  private lastFieldTitle: string = "";
  private lastRobotTitle: string = "";
  private lastRobotVisible: boolean = false;

  private coneTextureGreen: THREE.Texture;
  private coneTextureGreenBase: THREE.Texture;
  private coneTextureBlue: THREE.Texture;
  private coneTextureBlueBase: THREE.Texture;
  private coneTextureYellow: THREE.Texture;
  private coneTextureYellowBase: THREE.Texture;

  constructor(content: HTMLElement, canvas: HTMLCanvasElement) {
    this.content = content;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas });
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.scene = new THREE.Scene();

    // Change camera menu
    let startPx: [number, number] | null = null;
    canvas.addEventListener("contextmenu", (event) => {
      startPx = [event.x, event.y];
    });
    canvas.addEventListener("mouseup", (event) => {
      if (startPx && event.x == startPx[0] && event.y == startPx[1]) {
        if (!this.command) return;
        let robotTitle = this.command.options.robot;
        let robotConfig = window.frcData?.robots.find((robotData) => robotData.title === robotTitle);
        if (robotConfig == undefined) return;
        window.sendMainMessage("ask-3d-camera", {
          options: robotConfig.cameras.map((camera) => camera.name),
          selectedIndex: this.cameraIndex >= robotConfig.cameras.length ? -1 : this.cameraIndex
        });
      }
      startPx = null;
    });

    // Create coordinate groups
    this.wpilibCoordinateGroup = new THREE.Group();
    this.scene.add(this.wpilibCoordinateGroup);
    this.wpilibCoordinateGroup.rotation.setFromQuaternion(this.WPILIB_ROTATION);
    this.wpilibFieldCoordinateGroup = new THREE.Group();
    this.wpilibCoordinateGroup.add(this.wpilibFieldCoordinateGroup);

    // Create camera
    {
      const fov = this.ORBIT_FOV;
      const aspect = 2;
      const near = 0.1;
      const far = 100;
      this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
      this.camera.position.copy(this.ORBIT_FIELD_DEFAULT_POSITION);
      this.camera.lookAt(this.ORBIT_DEFAULT_TARGET.x, this.ORBIT_DEFAULT_TARGET.y, this.ORBIT_DEFAULT_TARGET.z);
    }

    // Create controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(this.ORBIT_DEFAULT_TARGET);
    this.controls.maxDistance = 30;
    this.controls.enabled = true;
    this.controls.update();

    // Add lights
    {
      const skyColor = 0xffffff;
      const groundColor = 0x000000;
      const intensity = 0.5;
      const light = new THREE.HemisphereLight(skyColor, groundColor, intensity);
      this.scene.add(light);
    }
    {
      const color = 0xffffff;
      const intensity = 0.2;
      const light = new THREE.PointLight(color, intensity);
      light.position.set(-12, 10, -12);
      this.scene.add(light);
    }
    {
      const color = 0xffffff;
      const intensity = 0.2;
      const light = new THREE.PointLight(color, intensity);
      light.position.set(0, -10, 0);
      this.scene.add(light);
    }

    // Load cone textures
    const loader = new THREE.TextureLoader();
    this.coneTextureGreen = loader.load("../www/textures/cone-green.png");
    this.coneTextureBlue = loader.load("../www/textures/cone-blue.png");
    this.coneTextureYellow = loader.load("../www/textures/cone-yellow.png");
    this.coneTextureGreen.offset.set(0.25, 0);
    this.coneTextureBlue.offset.set(0.25, 0);
    this.coneTextureYellow.offset.set(0.25, 0);
    this.coneTextureGreenBase = loader.load("../www/textures/cone-green-base.png");
    this.coneTextureBlueBase = loader.load("../www/textures/cone-blue-base.png");
    this.coneTextureYellowBase = loader.load("../www/textures/cone-yellow-base.png");

    // Render when camera is moved
    this.controls.addEventListener("change", () => (this.shouldRender = true));

    // Render loop
    let periodic = () => {
      this.renderFrame();
      window.requestAnimationFrame(periodic);
    };
    window.requestAnimationFrame(periodic);
  }

  /** Switches the selected camera. */
  set3DCamera(index: number) {
    this.cameraIndex = index;
    this.shouldRender = true;
  }

  render(command: any): number | null {
    if (JSON.stringify(command) != JSON.stringify(this.command)) {
      this.shouldRender = true;
    }
    this.command = command;
    return this.lastAspectRatio;
  }

  private renderFrame() {
    // Check for new render mode
    if (window.preferences) {
      if (window.preferences.threeDimensionMode != this.lastPrefsMode) {
        this.shouldRender = true;
        this.lastPrefsMode = window.preferences.threeDimensionMode;
      }
    }

    // Check for new size, device pixel ratio, or theme
    let isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (
      this.renderer.domElement.clientWidth != this.lastWidth ||
      this.renderer.domElement.clientHeight != this.lastHeight ||
      window.devicePixelRatio != this.lastDevicePixelRatio ||
      isDark != this.lastIsDark
    ) {
      this.lastWidth = this.renderer.domElement.clientWidth;
      this.lastHeight = this.renderer.domElement.clientHeight;
      this.lastDevicePixelRatio = window.devicePixelRatio;
      this.lastIsDark = isDark;
      this.shouldRender = true;
    }

    // Exit if no command is set
    if (!this.command) {
      return; // Continue trying to render
    }

    // Exit if not visible
    if (this.content.hidden) {
      return; // Continue trying to render
    }

    // Limit FPS in efficiency mode
    let now = new Date().getTime();
    if (
      window.preferences?.threeDimensionMode == "efficiency" &&
      now - this.lastFrameTime < 1000 / this.EFFICIENCY_MAX_FPS
    ) {
      return; // Continue trying to render
    }

    // Check if rendering should continue
    if (!this.shouldRender) {
      return;
    }
    this.lastFrameTime = now;
    this.shouldRender = false;

    // Get config
    let fieldTitle = this.command.options.field;
    let robotTitle = this.command.options.robot;
    let fieldConfig = window.frcData?.field3ds.find((fieldData) => fieldData.title === fieldTitle);
    let robotConfig = window.frcData?.robots.find((robotData) => robotData.title === robotTitle);
    if (fieldConfig == undefined || robotConfig == undefined) return;

    // Check for new FRC data
    let frcDataString = JSON.stringify(window.frcData);
    let newFrcData = frcDataString != this.lastFrcDataString;
    if (newFrcData) this.lastFrcDataString = frcDataString;

    // Add field
    if (fieldTitle != this.lastFieldTitle) {
      this.lastFieldTitle = fieldTitle;
      if (this.field) {
        this.wpilibCoordinateGroup.remove(this.field);
      }
      const loader = new GLTFLoader();
      loader.load(fieldConfig.path, (gltf) => {
        if (fieldConfig == undefined) return;

        // Add to scene
        this.field = gltf.scene;
        this.field.rotation.setFromQuaternion(this.getQuaternionFromRotSeq(fieldConfig.rotations));
        this.wpilibCoordinateGroup.add(this.field);

        // Render new frame
        this.shouldRender = true;
      });
    }

    // Add robot
    if (robotTitle != this.lastRobotTitle || newFrcData) {
      this.lastRobotTitle = robotTitle;
      if (this.robot && this.lastRobotVisible) {
        this.wpilibFieldCoordinateGroup.remove(this.robot);
      }
      this.robot = null;
      this.robotCameras = [];

      const loader = new GLTFLoader();
      loader.load(robotConfig.path, (gltf) => {
        if (robotConfig == undefined) return;

        // Set position and rotation of model
        let robotModel = gltf.scene;
        robotModel.rotation.setFromQuaternion(this.getQuaternionFromRotSeq(robotConfig.rotations));
        robotModel.position.set(...robotConfig.position);

        // Create group and add to scene
        this.robot = new THREE.Group().add(robotModel);
        if (this.lastRobotVisible) {
          this.wpilibFieldCoordinateGroup.add(this.robot);
        }

        // Set up cameras
        this.robotCameras = robotConfig.cameras.map((camera) => {
          let cameraObj = new THREE.Object3D();
          const extraRotations: Config3d_Rotation[] = [
            {
              axis: "z",
              degrees: -90
            },
            {
              axis: "y",
              degrees: -90
            }
          ];
          cameraObj.rotation.setFromQuaternion(this.getQuaternionFromRotSeq([...extraRotations, ...camera.rotations]));
          cameraObj.position.set(...camera.position);
          this.robot?.add(cameraObj);
          return cameraObj;
        });

        // Render new frame
        this.shouldRender = true;
      });
    }

    // Update field coordinates
    if (fieldConfig) {
      let isBlue = this.command.options.alliance == "blue";
      this.wpilibFieldCoordinateGroup.setRotationFromAxisAngle(new THREE.Vector3(0, 0, 1), isBlue ? 0 : Math.PI);
      this.wpilibFieldCoordinateGroup.position.set(
        convert(fieldConfig.widthInches / 2, "inches", "meters") * (isBlue ? -1 : 1),
        convert(fieldConfig.heightInches / 2, "inches", "meters") * (isBlue ? -1 : 1),
        0
      );
    }

    // Set robot position
    if (this.robot) {
      let robotPose: Pose3d | null = this.command.poses.robot;
      if (robotPose != null) {
        if (!this.lastRobotVisible) {
          this.wpilibFieldCoordinateGroup.add(this.robot);
        }

        // Set position and rotation
        this.robot.position.set(...robotPose.position);
        this.robot.rotation.setFromQuaternion(
          new Quaternion(robotPose.rotation[1], robotPose.rotation[2], robotPose.rotation[3], robotPose.rotation[0])
        );
      } else if (this.lastRobotVisible) {
        // Robot is no longer visible, remove
        this.wpilibFieldCoordinateGroup.remove(this.robot);
      }
      this.lastRobotVisible = robotPose != null;
    }

    // Function to update a set of cones
    let updateCones = (
      poseData: Pose3d[],
      objectArray: THREE.Object3D[],
      texture: THREE.Texture,
      textureBase: THREE.Texture
    ) => {
      // Remove extra cones
      while (poseData.length < objectArray.length) {
        let cone = objectArray.pop();
        if (cone) this.wpilibFieldCoordinateGroup.remove(cone);
      }

      // Add new cones
      while (poseData.length > objectArray.length) {
        let cone = new THREE.Group();
        let coneMesh = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.25, 16, 32), [
          new THREE.MeshPhongMaterial({
            map: texture
          }),
          new THREE.MeshPhongMaterial(),
          new THREE.MeshPhongMaterial({
            map: textureBase
          })
        ]);
        coneMesh.position.set(-0.125, 0, 0);
        coneMesh.rotateZ(-Math.PI / 2);
        coneMesh.rotateY(-Math.PI / 2);
        cone.add(coneMesh);
        objectArray.push(cone);
        this.wpilibFieldCoordinateGroup.add(cone);
      }

      // Set cone poses
      poseData.forEach((pose, index) => {
        if (!fieldConfig) return;
        let cone = objectArray[index];
        cone.position.set(...pose.position);
        cone.rotation.setFromQuaternion(
          new Quaternion(pose.rotation[1], pose.rotation[2], pose.rotation[3], pose.rotation[0])
        );
      });
    };

    // Update all sets of cones
    updateCones(this.command.poses.green, this.greenCones, this.coneTextureGreen, this.coneTextureGreenBase);
    updateCones(this.command.poses.blue, this.blueCones, this.coneTextureBlue, this.coneTextureBlueBase);
    updateCones(this.command.poses.yellow, this.yellowCones, this.coneTextureYellow, this.coneTextureYellowBase);

    // Set camera for fixed views
    {
      // Reset camera index if invalid
      if (this.cameraIndex >= this.robotCameras.length) this.cameraIndex = -1;

      // Update camera controls
      let orbitalCamera = this.cameraIndex < 0;
      if (orbitalCamera != this.controls.enabled) {
        this.controls.enabled = orbitalCamera;
        this.controls.update();
      }

      // Update container and camera based on mode
      let fov = this.ORBIT_FOV;
      this.lastAspectRatio = null;
      if (orbitalCamera) {
        this.canvas.classList.remove("fixed");
        this.canvas.style.aspectRatio = "";
        if (this.cameraIndex == -1) {
          // Reset to default origin
          this.wpilibCoordinateGroup.position.set(0, 0, 0);
          this.wpilibCoordinateGroup.rotation.setFromQuaternion(this.WPILIB_ROTATION);
        } else if (this.robot) {
          // Shift based on robot location
          this.wpilibCoordinateGroup.position.set(0, 0, 0);
          this.wpilibCoordinateGroup.rotation.setFromQuaternion(new THREE.Quaternion());
          let position = this.robot.getWorldPosition(new THREE.Vector3());
          let rotation = this.robot.getWorldQuaternion(new THREE.Quaternion()).multiply(this.WPILIB_ROTATION);
          position.negate();
          rotation.invert();
          this.wpilibCoordinateGroup.position.copy(position.clone().applyQuaternion(rotation));
          this.wpilibCoordinateGroup.rotation.setFromQuaternion(rotation);
        }
        if (this.cameraIndex != this.lastCameraIndex) {
          if (this.cameraIndex == -1) {
            this.camera.position.copy(this.ORBIT_FIELD_DEFAULT_POSITION);
          } else {
            this.camera.position.copy(this.ORBIT_ROBOT_DEFAULT_POSITION);
          }
          this.controls.target.copy(this.ORBIT_DEFAULT_TARGET);
          this.controls.update();
        }
      } else {
        this.canvas.classList.add("fixed");
        let aspectRatio = 16 / 9;
        if (robotConfig) {
          // Get fixed aspect ratio and FOV
          let cameraConfig = robotConfig.cameras[this.cameraIndex];
          aspectRatio = cameraConfig.resolution[0] / cameraConfig.resolution[1];
          this.lastAspectRatio = aspectRatio;
          fov = (cameraConfig.fov * aspectRatio) / 2;
          this.canvas.style.aspectRatio = aspectRatio.toString();

          // Update camera position
          if (this.lastRobotVisible) {
            let cameraObj = this.robotCameras[this.cameraIndex];
            this.camera.position.copy(cameraObj.getWorldPosition(new THREE.Vector3()));
            this.camera.rotation.setFromQuaternion(cameraObj.getWorldQuaternion(new THREE.Quaternion()));
          }
        }
      }

      // Update camera FOV
      if (fov != this.camera.fov) {
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
      }

      this.lastCameraIndex = this.cameraIndex;
    }

    // Render new frame
    const devicePixelRatio = window.preferences?.threeDimensionMode == "efficiency" ? 1 : window.devicePixelRatio;
    const canvas = this.renderer.domElement;
    const clientWidth = canvas.clientWidth;
    const clientHeight = canvas.clientHeight;
    if (canvas.width / devicePixelRatio != clientWidth || canvas.height / devicePixelRatio != clientHeight) {
      this.renderer.setSize(clientWidth, clientHeight, false);
      this.camera.aspect = clientWidth / clientHeight;
      this.camera.updateProjectionMatrix();
    }
    this.scene.background = isDark ? new THREE.Color("#222222") : new THREE.Color("#ffffff");
    this.renderer.setPixelRatio(devicePixelRatio);
    this.renderer.render(this.scene, this.camera);
  }

  /** Converts a rotation sequence to a quaternion. */
  private getQuaternionFromRotSeq(rotations: Config3d_Rotation[]): THREE.Quaternion {
    let quaternion = new THREE.Quaternion();
    rotations.forEach((rotation) => {
      let axis = new THREE.Vector3(0, 0, 0);
      if (rotation.axis == "x") axis.setX(1);
      if (rotation.axis == "y") axis.setY(1);
      if (rotation.axis == "z") axis.setZ(1);
      quaternion.premultiply(
        new THREE.Quaternion().setFromAxisAngle(axis, convert(rotation.degrees, "degrees", "radians"))
      );
    });
    return quaternion;
  }

  private rotateTranslationByRotation(position: Vector3, rotation: Quaternion): Vector3 {
    let p = new THREE.Quaternion(position.x, position.y, position.z, 0);
    let qprime = rotation.clone();
    qprime.multiply(p);
    qprime.multiply(rotation.clone().invert());
    return new THREE.Vector3(qprime.x, qprime.y, qprime.z);
  }
}

export interface Pose3d {
  position: [number, number, number]; // X, Y, Z
  rotation: [number, number, number, number]; // W, X, Y, Z
}