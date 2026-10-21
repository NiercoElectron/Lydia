import { Application, Container, Graphics } from 'pixi.js'

const PROJECT_WIDTH = 10000
const PROJECT_HEIGHT = 10000

async function main() {
  const app = new Application()
  await app.init({
    resizeTo: window,
    background: '#808080',
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  })
  document.body.appendChild(app.canvas)

  // Everything that belongs to the drawing lives inside "world"; zoom and pan move this container
  const world = new Container()
  app.stage.addChild(world)

  // The paper: a white rectangle the size of the project
  const paper = new Graphics().rect(0, 0, PROJECT_WIDTH, PROJECT_HEIGHT).fill(0xffffff)
  world.addChild(paper)

  // Show the whole project, centered, with a small margin around it
  function fitToScreen() {
    const scale = Math.min(app.screen.width / PROJECT_WIDTH, app.screen.height / PROJECT_HEIGHT) * 0.9
    world.scale.set(scale)
    world.position.set((app.screen.width - PROJECT_WIDTH * scale) / 2, (app.screen.height - PROJECT_HEIGHT * scale) / 2)
  }
  fitToScreen()
}

main()
