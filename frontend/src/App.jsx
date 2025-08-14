import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import DeviceCard from './components/deviceCard'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div>
        <DeviceCard title={"Chimera"} image={"https://placehold.co/100x100/000000/FFF"}/>
        <DeviceCard title={"Black Box"} image={"https://placehold.co/100x100/000000/FFF"}/>
        <DeviceCard title={"PLC"} image={"https://placehold.co/100x100/000000/FFF"}/>
      </div>
      
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
      </div>
    </>
  )
}

export default App
