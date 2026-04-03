# What is this package?
The purpose of this directory is to provide a set of tools for calculating the pacing details of a cycling 
(running or anything, really) route. I developed this section of code to help me plan my cycling routes and to help me 
figure out where to stop for rest stops and the estimated arrival time to ensure the places are open. 

In the lead-up to the Mishigami Challenge, I utilized this to plan out theoretical paces and strategies; where time 
calculations were harder to keep track of. I could use this to quickly calculate the pacing details of a route and make adjustments as needed.

In my training for the Mishigami Challenge, I used it to steal a few KOMs--allowing me to plan out my efforts and know where to push hard and where to take it easy.

This package contains three areas:
- calculator
  - This is the core domain for the areas below and contains the logic for calculating the pacing details of a route. This area works independently and can be used as a standalone package.
- api
  - This is a RESTful API that exposes the functionality of the calculator for client applications to use. I plan to build this out more in the future, but for now it is just a basic implementation.
- printer
  - This is a console application that works like the `calculator` but prints the results to the console in a human-readable format. This is useful for quick calculations and for debugging purposes.


