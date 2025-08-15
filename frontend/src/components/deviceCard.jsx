import React from "react";

class DeviceCard extends React.Component {
    render() {
        const title = this.props.title;
        const image = this.props.image;
        return (
            <div className="card" style={{width:'100%'}}>
                <button onClick={() =>{alert(title)}} style={{width:'95%'}}>
                    <h2 style={{float:"left"}}>{title}</h2>
                    <img src={image}></img>
                </button>
            </div>
        )
    }
}

export default DeviceCard