import React from "react";
import settingsCog from '../assets/cog.svg';

function DeviceCard(props){
    return (
        <div className="bg-white rounded-lg shadow-md p-8 mb-4 border border-gray-200 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between gap-6">
                <div className="flex-1 text-left">
                    <h2 className="text-3xl font-bold text-gray-800">{props.title}</h2>
                    <p className="text-lg text-gray-600 mt-2">{props.name}</p>
                    <div className="mt-3 flex items-center justify-between">
                        <span className="text-base text-green-600 font-medium">● Connected</span>
                        <img 
                            src={settingsCog}
                            onClick={() => alert(`Settings for ${props.name}`)}
                            className="w-8 h-8 cursor-pointer transform transition-transform duration-200 ease-in-out hover:scale-125"
                            style={{ filter: 'invert(0.4)' }}
                            aria-label="Settings"
                            alt="Settings"
                        />
                    </div>
                </div>
                
                <img 
                    src={props.image} 
                    alt={props.title}
                    className="h-28 w-auto rounded-lg object-contain"
                />
            </div>
        </div>
    )
}


export default DeviceCard