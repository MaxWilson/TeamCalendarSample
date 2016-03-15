/// <reference path='../../../typings/VSS.d.ts' />
/// <reference path='../../../typings/q.d.ts' />
/// <reference path='../../../typings/jquery.d.ts' />

import Calendar_Contracts = require("Calendar/Contracts");
import Calendar_DateUtils = require("Calendar/Utils/Date");
import Calendar_ColorUtils = require("Calendar/Utils/Color");
import Contracts_Platform = require("VSS/Common/Contracts/Platform");
import Contributions_Contracts = require("VSS/Contributions/Contracts");
import ExtensionManagement_RestClient = require("VSS/ExtensionManagement/RestClient");
import FreeForm_Enhancer = require("Calendar/Enhancers/FreeFormEnhancer");
import Services_ExtensionData = require("VSS/SDK/Services/ExtensionData");
import Q = require("q");
import Service = require("VSS/Service");
import Utils_Core = require("VSS/Utils/Core");
import Utils_Date = require("VSS/Utils/Date");
import Utils_String = require("VSS/Utils/String");
import WebApi_Constants = require("VSS/WebApi/Constants");

export class FreeFormEventsSource implements Calendar_Contracts.IEventSource {

    public id = "freeForm";
    public name = "Event";
    public order = 10;
    private _enhancer: FreeForm_Enhancer.FreeFormEnhancer;

    private _teamId: string;
    private _events: Calendar_Contracts.CalendarEvent[];
    private _categories: Calendar_Contracts.IEventCategory[];

    constructor() {
        var webContext = VSS.getWebContext();
        this._teamId = webContext.team.id;
    }
    
    public load(): IPromise<Calendar_Contracts.CalendarEvent[]> {
        return this.getEvents().then((events: Calendar_Contracts.CalendarEvent[]) => {
            var updatedEvents: Calendar_Contracts.CalendarEvent[] = [];
            $.each(events, (index: number, event: Calendar_Contracts.CalendarEvent) => {
                
                // For now, skip events with date strngs we can't parse.
                if(Date.parse(event.startDate) && Date.parse(event.endDate)) {
                    var start = Utils_Date.shiftToUTC(new Date(event.startDate));
                    var end = Utils_Date.shiftToUTC(new Date(event.endDate));
                    
                    if(start.getHours() !== 0) {
                        // Set dates back to midnight                    
                        start.setHours(0);
                        end.setHours(0);
                        // update the event in the list
                        event.startDate = Utils_Date.shiftToLocal(start).toISOString();
                        event.endDate = Utils_Date.shiftToLocal(end).toISOString();
                        this.updateEvent(null, event);
                    }
                    updatedEvents.push(event);
                }
            });
            return updatedEvents;
        });
    }
    
    public getEnhancer(): IPromise<Calendar_Contracts.IEventEnhancer> {
        if(!this._enhancer){
            this._enhancer = new FreeForm_Enhancer.FreeFormEnhancer();
        }
        return Q.resolve(this._enhancer);
    }

    public getEvents(query?: Calendar_Contracts.IEventQuery): IPromise<Calendar_Contracts.CalendarEvent[]> {
        var deferred = Q.defer<Calendar_Contracts.CalendarEvent[]>();
        VSS.getService("ms.vss-web.data-service").then((extensionDataService: Services_ExtensionData.ExtensionDataService) => {
            this.getCategories(query).then((categories: Calendar_Contracts.IEventCategory[]) => {
                extensionDataService.queryCollectionNames([this._teamId]).then(
                    (collections: Contributions_Contracts.ExtensionDataCollection[]) => {
                        if (collections[0] && collections[0].documents) {
                            this._events = collections[0].documents.filter((document: any) => { return !!document.startDate; });
                        }
                        else {
                            this._events = [];
                        }
                        // legacy events
                        $.each(this._events, (index: number, event: Calendar_Contracts.CalendarEvent) => { 
                            event.movable = true;
                            var category = event.category
                            if(!category || typeof(category) === 'string') {
                                event.category = <Calendar_Contracts.IEventCategory> {
                                    title: category || "Uncategorized",
                                    id: this.id + "." + category || "Uncategorized"
                                }
                            }
                        })
                        deferred.resolve(this._events);
                        this._updateCategoryForEvents(this._events);
                    },
                    (e: Error) => {
                        this._events = [];
                        deferred.resolve(this._events);
                    });
            });
        });

        return deferred.promise;
    }

    public getCategories(query?: Calendar_Contracts.IEventQuery): IPromise<Calendar_Contracts.IEventCategory[]> {
        var deferred = Q.defer();
        VSS.getService("ms.vss-web.data-service").then((extensionDataService: Services_ExtensionData.ExtensionDataService) => {
           extensionDataService.queryCollectionNames([this._teamId]).then((collections: Contributions_Contracts.ExtensionDataCollection[]) => {
               if(collections[0] && collections[0].documents) {
                   this._categories = collections[0].documents.filter((document: any) => { return (!document.startDate && document.id.split(".")[0] === this.id); });
               }
               else {
                   this._categories = [];
               }
               deferred.resolve(this._categories);
           }, (e: Error) => {
               this._categories = [];
               deferred.resolve(this._categories);
           });
        });
        return deferred.promise;
    }

    public addEvent(event: Calendar_Contracts.CalendarEvent): IPromise<Calendar_Contracts.CalendarEvent> {
        var deferred = Q.defer();
        VSS.getService("ms.vss-web.data-service").then((extensionDataService: Services_ExtensionData.ExtensionDataService) => {
            
            extensionDataService.createDocument(this._teamId, event).then(
                (addedEvent: Calendar_Contracts.CalendarEvent) => {
                    // update category for event
                    addedEvent.category.id = this.id + "." + addedEvent.category.title;
                    this._updateCategoryForEvents([addedEvent]);
                    // add event
                    this._events.push(addedEvent);
                    deferred.resolve(addedEvent);
                },
                (e: Error) => {
                    deferred.reject(e);
                });
        });
        return deferred.promise;
    }
    
    public addCategory(category: Calendar_Contracts.IEventCategory): IPromise<Calendar_Contracts.IEventCategory> {
        var deferred = Q.defer();
        VSS.getService("ms.vss-web.data-service").then((extensionDataService: Services_ExtensionData.ExtensionDataService) => {
            extensionDataService.createDocument(this._teamId, category).then((addedCategory: Calendar_Contracts.IEventCategory) => {
                this._categories.push(addedCategory);
                deferred.resolve(addedCategory);
            }, (e: Error) => {
                deferred.reject(e);
            });
        });
        return deferred.promise;
    }
    
    public removeEvent(event: Calendar_Contracts.CalendarEvent): IPromise<Calendar_Contracts.CalendarEvent[]> {
        var deferred = Q.defer();
        VSS.getService("ms.vss-web.data-service").then((extensionDataService: Services_ExtensionData.ExtensionDataService) => {
            extensionDataService.deleteDocument(this._teamId, event.id).then(
                () => {
                    // update category for event
                    event.category = null;
                    this._updateCategoryForEvents([event]);
                    // remove event
                    var eventInArray: Calendar_Contracts.CalendarEvent = $.grep(this._events, function (e: Calendar_Contracts.CalendarEvent) { return e.id === event.id; })[0]; //better check here
                    var index = this._events.indexOf(eventInArray);
                    if (index > -1) {
                        this._events.splice(index, 1);
                    }
                    deferred.resolve(this._events);
                },
                (e: Error) => {
                    //Handle event has already been deleted
                    deferred.reject(e);
                });
        });
        return deferred.promise;
    }
    
    public removeCategory(category: Calendar_Contracts.IEventCategory): IPromise<Calendar_Contracts.IEventCategory[]> {
        var deferred = Q.defer();
        VSS.getService("ms.vss-web.data-service").then((extensionDataService: Services_ExtensionData.ExtensionDataService) => {
           extensionDataService.deleteDocument(this._teamId, category.id).then(() => {
               var categoryInArray: Calendar_Contracts.IEventCategory = $.grep(this._categories, function (cat: Calendar_Contracts.IEventCategory) { return cat.id === category.id})[0];
               var index = this._categories.indexOf(categoryInArray);
               if(index > -1) {
                   this._categories.splice(index, 1);
               }
               deferred.resolve(this._categories);
           }, (e: Error) => {
               deferred.reject(e);
           }); 
        });
        return deferred.promise;
    }

    public updateEvent(oldEvent: Calendar_Contracts.CalendarEvent, newEvent: Calendar_Contracts.CalendarEvent): IPromise<Calendar_Contracts.CalendarEvent> {
        var deferred = Q.defer();
        return VSS.getService("ms.vss-web.data-service").then((extensionDataService: Services_ExtensionData.ExtensionDataService) => {
            // update category for event
            newEvent.category.id = this.id + "." + newEvent.category.title;
            this._updateCategoryForEvents([newEvent]);
            
            extensionDataService.updateDocument(this._teamId, newEvent).then(
                (updatedEvent: Calendar_Contracts.CalendarEvent) => {
                    var eventInArray: Calendar_Contracts.CalendarEvent = $.grep(this._events, function (e: Calendar_Contracts.CalendarEvent) { return e.id === updatedEvent.id; })[0]; //better check here
                    var index = this._events.indexOf(eventInArray);
                    if (index > -1) {
                        this._events.splice(index, 1);
                    }
                    this._events.push(updatedEvent);
                    deferred.resolve(updatedEvent);
                },
                (e: Error) => {
                    //Handle concurrency issue
                    return Q.reject(e);
                });
            return deferred.promise;
        },
        (e: Error) => {
            //Handle concurrency issue
            return Q.reject(e);
        });
    }
    
    public updateCategories(categories: Calendar_Contracts.IEventCategory[]): IPromise<Calendar_Contracts.IEventCategory[]> {
        return VSS.getService("ms.vss-web.data-service").then((extensionDataService: Services_ExtensionData.ExtensionDataService) => {
            var updatedCategoriesPromises: IPromise<Calendar_Contracts.IEventCategory>[] = [];
            $.each(categories, (index: number, category: Calendar_Contracts.IEventCategory) => {
                updatedCategoriesPromises.push(extensionDataService.updateDocument(this._teamId, categories[index]).then((updatedCategory: Calendar_Contracts.IEventCategory) => {
                    var categoryInArray: Calendar_Contracts.IEventCategory = $.grep(this._categories, (cat: Calendar_Contracts.IEventCategory) => { return cat.id === category.id})[0];
                    var index = this._categories.indexOf(categoryInArray);
                    if(index > -1) {
                        this._categories.splice(index, 1);
                    }
                    this._categories.push(updatedCategory);
                    return updatedCategory;
                }));
            });
            return Q.all(updatedCategoriesPromises);
        });
    }
    
    public getTitleUrl(webContext: WebContext): IPromise<string> {
        var deferred = Q.defer();
        deferred.resolve("");
        return deferred.promise;
    }
    
    private _updateCategoryForEvents(events: Calendar_Contracts.CalendarEvent[]) {
        var updatedCategories = [];
                
        // remove event from current category        
        for(var i = 0; i < events.length; i++) {
            var event = events[i]
            var categoryForEvent = $.grep(this._categories, (cat: Calendar_Contracts.IEventCategory) => {
                return cat.events.indexOf(event.id) > -1;
            })[0];
            if(categoryForEvent){
                // Do nothing if category hasn't changed
                if(event.category && (event.category.title === categoryForEvent.title)) {
                    event.category = categoryForEvent;
                    return;
                }
                var index = categoryForEvent.events.indexOf(event.id);
                categoryForEvent.events.splice(index, 1);
                var count = categoryForEvent.events.length
                categoryForEvent.subTitle = Utils_String.format("{0} event{1}", count, count > 1 ? "s" : "");
                if(categoryForEvent.events.length === 0){
                    this.removeCategory(categoryForEvent);
                }
                else {
                    updatedCategories.push(categoryForEvent);
                }
            }
            // add event to new category
            if(event.category){
                var newCategory = $.grep(this._categories, (cat: Calendar_Contracts.IEventCategory) => {
                    return cat.id === event.category.id;
                })[0];
                if(newCategory){
                // category already exists
                    newCategory.events.push(event.id);
                    var count = newCategory.events.length
                    newCategory.subTitle = Utils_String.format("{0} event{1}", count, count > 1 ? "s" : "");
                    event.category = newCategory;
                    updatedCategories.push(newCategory);
                }
                else {
                // category doesn't exist yet
                var newCategory = event.category;
                    newCategory.events = [event.id];
                    newCategory.subTitle = event.title;
                    newCategory.color = Calendar_ColorUtils.generateColor(event.category.title);
                    this.addCategory(newCategory);
                }
            }
        }
        // update categories
        this.updateCategories(updatedCategories);
    }
}